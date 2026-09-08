import { Router } from 'express';
import path from 'path';
import fsp from 'fs/promises';
import { createParser } from '../../../Public/_file/parser.js';
import { createSaveOriginal } from '../../../Public/_file/saveOriginfile.js';
import { QUARANTINE_DIR } from '../../../Public/_file/paths.js';
import {
  assertUploadIsValid,
  MAX_UPLOAD_BYTES,
} from '../../../Public/_file/magic.js';
import { createPythonPdfParser } from '../../../Public/_file/pythonPdf.js';
import { createJobRegistry } from '../proxy/jobs.js';
import { createTextHolder } from '../text/content.js';
import { createRawSaver } from '../generator/rawSaver.js';
import { createInputHandler } from '../proxy/requestHandler.js';

// Multer only runs for multipart bodies; a JSON submission skips it entirely.
//
// Its errors have to be caught HERE. Left to bubble, they reach Express's
// default handler and the client gets an HTML 500 for what is really a plain
// "your file is too big" — and the frontend, which reads res.json(), would
// show "Unexpected token <" instead of the reason.
const maybeUpload = (upload) => (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('multipart/form-data')) return next();

  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(413).json({
          error: `File too large. Maximum ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB allowed.`,
        });
      case 'UNSUPPORTED_FILE_TYPE':
        return res.status(415).json({ error: err.message });
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_UNEXPECTED_FILE':
        return res
          .status(400)
          .json({ error: 'Send exactly one file, in a field named "file".' });
      default:
        return res.status(400).json({ error: `Upload failed: ${err.message}` });
    }
  });
};

// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
export function createIncomingRouter({ upload, pool, request, jobs = createJobRegistry() }) {
  const saveOriginal = createSaveOriginal({
    quarantineDir: QUARANTINE_DIR,
  });
  const parser = createParser({
    saveOriginal,
    // The slot that used to throw "PDF parser not configured".
    pdfParser: createPythonPdfParser(),
  });
  const textHolder = createTextHolder();
  const rawSaver = createRawSaver();
  const inputHandler = createInputHandler({
    textHolder,
    metadataGuard: request,
    rawSaver,
  });

  const router = Router();

  router.post('/', maybeUpload(upload), async (req, res) => {
    try {
      const source = req.file ? 'file' : 'text';
      let parsedText = null;
      let quarantinePath = null;

      // 0) Byte-level validation, before anything reads the contents.
      //    multer only ever saw the client's filename and mimetype; this is
      //    the first check that looks at the actual bytes.
      if (req.file) {
        try {
          await assertUploadIsValid(req.file.path, req.file.originalname);
        } catch (err) {
          await fsp.unlink(req.file.path).catch(() => {}); // don't keep rejects
          return res.status(415).json({ error: err.message });
        }
      }

      // 1) Quota gate
      const quota = await request.checkQuota({ userId: req.userId });
      if (!quota.allowed) {
        // Carry the full status so the UI can update its badge from the
        // rejection itself, without a second round trip.
        return res.status(429).json({
          error: 'Quota exceeded',
          remaining: quota.remaining,
          quota: await request.getQuota({ userId: req.userId }),
        });
      }

      // 2) Create upload session
      const formId = await request.createUploadSession({
        userId: req.userId,
        visitorHash: req.visitorHash,
        source,
      });

      // 3) Decide who parses, and therefore how this request ends.
      //
      //    Browser-parsed (.txt/.docx): the text is already in the request.
      //    Nothing to wait for — finish synchronously, exactly as before.
      //
      //    Server-parsed (.pdf always, .doc, or any client that sent no text):
      //    the Python extractor has to read the file. That is real work, so the
      //    request does NOT sit on it; we answer with the formId and run the
      //    extraction behind that token, where the client already knows how to
      //    poll for it.
      //
      //    PDF is excluded from the trust path on purpose. pdf.js resolves text
      //    through the PDF's ToUnicode CMaps, which on Zawgyi documents point at
      //    imposter lookalikes — measured p(zawgyi)=1.000 on test.pdf. Accepting
      //    that text would store confident garbage AND skip the extractor that
      //    exists to prevent it, so a PDF is always re-read server-side no
      //    matter what the client sends.
      if (req.file) {
        const isPdf = path.extname(req.file.originalname).toLowerCase() === '.pdf';
        const clientText =
          !isPdf && typeof req.body?.text === 'string' && req.body.text.trim()
            ? req.body.text
            : null;

        if (!clientText) {
          // ── Fast return: hand back the token, keep working ───────────────
          const file = req.file;
          const handoff = {
            userId: req.userId,
            visitorHash: req.visitorHash,
            file,
          };

          jobs.start(
            formId,
            async () => {
              const parsed = await parser(file);
              const chained = await inputHandler({
                // The response is already sent; req must not be touched from
                // here (Express recycles it), so the chain gets a plain object
                // carrying only what it actually reads.
                req: {
                  userId: handoff.userId,
                  visitorHash: handoff.visitorHash,
                  file: handoff.file,
                },
                formId,
                parsedText: parsed.textContent,
                quarantinePath: parsed.savedPath,
              });
              return {
                text: parsed.textContent,
                submitId: chained.submitId,
                // Read AFTER the save gate charged it, so a client polling for
                // the text gets the authoritative counter with it.
                quota: await request.getQuota({ userId: handoff.userId }),
              };
            },
            { fileName: file.originalname },
          );

          return res.status(202).json({
            formId,
            status: 'extracting',
            fileName: file.originalname,
            // Not yet charged — the save gate bills at the moment the .txt
            // lands, which has not happened. The poll that returns the text
            // carries the updated counter.
            quota: await request.getQuota({ userId: req.userId }),
          });
        }

        parsedText = clientText;
        quarantinePath = await saveOriginal(req.file); // silent reference copy
      }

      // 4) Chain: validate → hold text → save raw → commit (gate + charge)
      const result = await inputHandler({
        req,
        formId,
        parsedText,
        quarantinePath,
      });

      // 5) Report the quota this submission just spent.
      //    Charged inside the chain above at the moment the .txt hit disk —
      //    never before the parse finished.
      const quotaAfter = await request.getQuota({ userId: req.userId });

      // 6) Return formId + text for frontend textarea
      const textContent = source === 'file' ? parsedText : req.body?.text || '';
      res.status(202).json({
        formId,
        submitId: result.submitId,
        text: textContent,
        status: 'pending',
        quota: quotaAfter,
      });
    } catch (err) {
      console.error('[incoming]', err);
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
