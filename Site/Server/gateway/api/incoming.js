import { Router } from 'express';
import path from 'path';
import { createParser } from '../../../Public/_file/parser.js';
import {
  createPythonPdfParser,
  createPythonDocxParser,
  createPraserDocxRenderer,
} from '../../../Public/_file/pythonPdf.js';
import { createSaveOriginal } from '../../../Public/_file/saveOriginfile.js';
import { QUARANTINE_DIR, OUTPUT_DOCX_DIR } from '../../../Public/_file/paths.js';
import { createEngineBridge } from '../generator/engine.js';
import { createTextHolder } from '../text/content.js';
import { createRawSaver } from '../generator/rawSaver.js';
import { createInputHandler } from '../proxy/requestHandler.js';

const maybeUpload = (upload) => (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  ct.includes('multipart/form-data')
    ? upload.single('file')(req, res, next)
    : next();
};

// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
export function createIncomingRouter({ upload, pool, request }) {
  const saveOriginal = createSaveOriginal({
    quarantineDir: QUARANTINE_DIR,
  });
  // .pdf and .docx are server-only: the PRASER Python side does the encoding
  // work (embedded-cmap/model decoding + Zawgyi→Unicode) that browser
  // extractors cannot (see _file/pythonPdf.js). These injections are what
  // make a bare PDF or DOCX upload parse.
  const parser = createParser({
    saveOriginal,
    pdfParser: createPythonPdfParser(),
    docxParser: createPythonDocxParser(),
  });
  const textHolder = createTextHolder();
  const rawSaver = createRawSaver();
  const inputHandler = createInputHandler({
    textHolder,
    metadataGuard: request,
    rawSaver,
  });
  // Site → Private connection: after parsing finishes, the result goes to
  // the Engine in the request BODY (decision rationale in engine.js), tagged
  // with submitId as the hash. The docx renderer re-wraps the Engine's
  // processed text back into a .docx for docx uploads.
  const engineBridge = createEngineBridge();
  const docxRenderer = createPraserDocxRenderer()();

  const router = Router();

  router.post('/', maybeUpload(upload), async (req, res) => {
    try {
      const source = req.file ? 'file' : 'text';
      let parsedText = null;

      // 1) Quota gate
      const quota = await request.checkQuota({ userId: req.userId });
      if (!quota.allowed) {
        return res.status(429).json({
          error: 'Quota exceeded',
          remaining: quota.remaining,
        });
      }

      // 2) Create upload session
      const formId = await request.createUploadSession({
        userId: req.userId,
        visitorHash: req.visitorHash,
        source,
      });

      // 3) File handling — EVERY file is parsed server-side. Browser
      //    extractors pass Zawgyi/imposter code points straight through;
      //    only the PRASER side does the encoding work. The request-carried
      //    `text` field is for plain text submissions (no file) only.
      //    The parser quarantines the original before parsing.
      let quarantinePath = null;
      if (req.file) {
        const parsed = await parser(req.file);
        parsedText = parsed.textContent;
        quarantinePath = parsed.savedPath; // ← quarantine path from parser
      }

      // 4) Chain: validate → hold text → save raw → finalize DB
      const result = await inputHandler({
        req,
        formId,
        parsedText,
        quarantinePath,   // ← pass it through
      });

      // 4b) Site → Private. Parsing is finished and the raw text is on
      //     disk — NOW open the engine connection and push the result
      //     (file submissions only: a plain-text submit never opened the
      //     PRASER connection). Sent in the BODY with submitId as the hash;
      //     a .docx upload comes back re-wrapped as .docx. Any engine
      //     failure degrades gracefully — the upload itself survives.
      let engine = null;
      if (source === 'file' && parsedText) {
        try {
          engine = await engineBridge.push({
            submitId: result.submitId,
            filename: result.filename, // the FRONTEND-created name ({submitId}{ext})
            text: parsedText,
            metadata: {
              formId,
              userId: req.userId, // validators, NOT optional (cookie chain)
              sessionId: req.visitorHash,
              source,
              originalName: req.file.originalname,
            },
          });
          const ext = req.file.originalname.split('.').pop().toLowerCase();
          if (ext === 'docx' && engine.text) {
            const outPath = path.join(OUTPUT_DOCX_DIR, `${result.submitId}.docx`);
            await docxRenderer(engine.text, outPath);
            engine.docxPath = outPath;
          }
        } catch (err) {
          console.error('[incoming] engine push:', err.message);
          engine = { connected: false, error: err.message };
        }
      }

      // 5) Burn quota
      await request.incrementQuota({ userId: req.userId });

      // 6) Return formId + text for frontend textarea (+ engine result)
      const textContent = source === 'file' ? parsedText : req.body?.text || '';
      res.status(202).json({
        formId,
        submitId: result.submitId,
        text: textContent,
        status: 'pending',
        ...(engine
          ? {
              engine: {
                connected: engine.connected,
                ...(engine.error ? { error: engine.error } : {}),
                ...(engine.engineHash ? { engineHash: engine.engineHash } : {}),
                ...(engine.syllableCount !== undefined
                  ? { syllableCount: engine.syllableCount }
                  : {}),
                ...(engine.docxPath ? { docxPath: engine.docxPath } : {}),
              },
            }
          : {}),
      });
    } catch (err) {
      console.error('[incoming]', err);
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
