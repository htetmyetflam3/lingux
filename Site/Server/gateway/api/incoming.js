import { Router } from 'express';
import { createParser } from '../../../Site/Public/_file/parser.js';
import { createSaveOriginal } from '../../../Site/Public/_file/saveOriginfile.js';
import { QUARANTINE_DIR } from '../../../Site/Public/_file/paths.js';
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
  const parser = createParser({ saveOriginal });
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

      // 3) File handling — the original is ALWAYS kept for reference:
      //    - with client text (browser parsed it via mammoth/pdf.js/FileReader):
      //      trust that text, skip server-side parsing, quarantine the original
      //    - without client text (.doc, or API clients): parse server-side
      let quarantinePath = null;
      if (req.file) {
        const clientText =
          typeof req.body?.text === 'string' && req.body.text.trim()
            ? req.body.text
            : null;

        if (clientText) {
          parsedText = clientText;
          quarantinePath = await saveOriginal(req.file); // silent reference copy
        } else {
          const parsed = await parser(req.file);
          parsedText = parsed.textContent;
          quarantinePath = parsed.savedPath;   // ← quarantine path from parser
        }
      }

      // 4) Chain: validate → hold text → save raw → finalize DB
      const result = await inputHandler({
        req,
        formId,
        parsedText,
        quarantinePath,   // ← pass it through
      });



      // 5) Burn quota
      await request.incrementQuota({ userId: req.userId });

      // 6) Return formId + text for frontend textarea
      const textContent = source === 'file' ? parsedText : req.body?.text || '';
      res.status(202).json({
        formId,
        submitId: result.submitId,
        text: textContent,
        status: 'pending',
      });
    } catch (err) {
      console.error('[incoming]', err);
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
