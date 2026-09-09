import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sessionBypassEnabled } from '../../cookie/devbypass.js';
import { RAW_TXT_DIR } from '../../../Public/_file/paths.js';

export function createHiddenRouter({ pool, fsmEndpoint, fsmKey }) {
  const router = Router();

  // ── POST /api/process ──
  // Looks up the submission, verifies the raw file exists,
  // then tells FSM where to pull it from.
  router.post(
    '/process',
    (req, res, next) => {
      const key = req.headers['x-api-key'] || req.body?.apiKey;
      if (key !== fsmKey) {
        return res.status(403).json({ error: 'Invalid API key' });
      }
      next();
    },
    async (req, res) => {
      try {
        const { formId } = req.body;
        const [rows] = await pool.query(
          'SELECT * FROM submissions WHERE submission_id = ?',
          [formId],
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });

        const meta = rows[0];
        const rawPath = meta.bridge_path;

        if (!rawPath || !fs.existsSync(rawPath)) {
          return res.status(404).json({ error: 'Raw file not found on disk' });
        }

        // Build internal pull URL so FSM can use its existing stream reader
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost';
        const fileUrl = `${protocol}://${host}/api/hidden/raw/${meta.submit_id}`;

        await fetch(fsmEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': fsmKey,
          },
          body: JSON.stringify({
            formId: meta.submission_id,
            userId: meta.user_id,
            sessionId: meta.session_id,
            fileName: meta.file_name,
            source: meta.source,
            status: meta.status,
            submitId: meta.submit_id,
            fileUrl,            // FSM fetches raw text from here
            apiKey: fsmKey,     // hint: same key works for the GET endpoint
          }),
        });

        res.status(204).end();
      } catch (err) {
        console.error('ERROR:', '[hidden] POST /process', err);
        res.status(500).json({ error: 'Internal error' });
      }
    },
  );

  // ── GET /api/hidden/raw/:submitId ──
  // Streams the raw file. FSM pulls this with its usual read-stream logic.
  router.get('/hidden/raw/:submitId', async (req, res) => {
    try {
      const key = req.headers['x-api-key'];
      if (key !== fsmKey) {
        return res.status(403).json({ error: 'Invalid API key' });
      }

      const { submitId } = req.params;

      let filePath;
      let fileName;
      if (sessionBypassEnabled()) {
        // DEV ONLY (DB unreachable): rawSaver writes deterministically to
        // .output/txt/{submitId}.txt, so resolve the file straight from disk
        // instead of the submissions row. sessionBypassEnabled fails closed,
        // so this never runs in production.
        filePath = path.join(RAW_TXT_DIR, `${submitId}.txt`);
        fileName = `${submitId}.txt`;
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: 'File not found' });
        }
      } else {
        const [rows] = await pool.query(
          'SELECT bridge_path, file_name FROM submissions WHERE submit_id = ?',
          [submitId],
        );
        if (!rows.length || !rows[0].bridge_path) {
          return res.status(404).json({ error: 'File not found' });
        }

        filePath = rows[0].bridge_path;
        fileName = rows[0].file_name || 'raw.txt';
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on('error', (err) => {
        console.error('[hidden] stream error:', err);
        if (!res.headersSent) res.status(500).end();
      });
    } catch (err) {
      console.error('ERROR:', '[hidden] GET /raw', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return router;
}
