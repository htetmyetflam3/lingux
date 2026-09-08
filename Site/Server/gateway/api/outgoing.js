import logger from '../../../../Private/Bridge/logen.js';
import { Router } from 'express';
import { createOutgoingResponseHandler } from '../proxy/responseHandler.js';
export function createOutgoingRouter({ pool, request, jobs = null }) {
  const responseHandler = createOutgoingResponseHandler({ pool });
  const router = Router();

  // ── GET /api/quota ──────────────────────────────────────────────────────
  // Up-front quota status for the frontend: asked on load and after every
  // submit, so the Check button knows the answer BEFORE the user commits a
  // file. Read-only — it never burns or rolls the counter.
  //
  // This does NOT replace the gate in the submit chain. A client-side check is
  // a courtesy to the user; incoming.js still calls checkQuota() and remains
  // the thing that actually enforces it.
  router.get('/quota', async (req, res) => {
    try {
      const quota = await request.getQuota({ userId: req.userId });
      res.json({ status: 'ok', ...quota });
    } catch (err) {
      logger.log('ERROR:', '[outgoing] GET /quota', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/result', async (req, res) => {
    try {
      const { formId } = req.body || {};
      if (!formId) {
        return res.status(400).json({ error: 'formId required' });
      }
      await request.validateSubmission({
        userId: req.userId,
        formId,
        source: 'existing',
      });

      // ── Extraction stage ────────────────────────────────────────────────
      // A server-parsed upload (.pdf/.doc) answered immediately and left its
      // work running behind this formId. Report that stage here, before
      // looking for an engine result that cannot exist yet.
      //
      // Checked ahead of the dev-bypass short-circuit below: extraction is
      // real work that really happened, whether or not the DB recorded it.
      const job = jobs?.get(formId);
      if (job) {
        if (job.state === 'queued' || job.state === 'extracting') {
          // 202, not 404: "not ready" and "no such thing" are different
          // answers, and only one of them is worth waiting on.
          return res.status(202).json({
            status: 'extracting',
            formId,
            fileName: job.fileName || null,
          });
        }
        if (job.state === 'failed') {
          // Terminal. Say so, so the client stops polling and shows why
          // instead of counting down to a meaningless timeout.
          return res.status(422).json({
            status: 'failed',
            formId,
            error: job.error || 'Extraction failed',
          });
        }
        // job.state === 'done' — the text exists. Hand it over now; the engine
        // result, if there is going to be one, arrives on a later poll.
        if (process.env.DEV_BYPASS_QUOTA === 'true') {
          return res.json({
            status: 'extracted',
            formId,
            submitId: job.submitId,
            text: job.text,
            quota: job.quota,
          });
        }
        const engineResult = await responseHandler({ formId, userId: req.userId });
        if (!engineResult) {
          return res.json({
            status: 'extracted',
            formId,
            submitId: job.submitId,
            text: job.text,
            quota: job.quota,
          });
        }
        return res.json({
          status: 'ok',
          text: job.text,
          quota: job.quota,
          data: engineResult,
        });
      }

      if (process.env.DEV_BYPASS_QUOTA === 'true') {
        // dev bypass: nothing was persisted, so there is no result to look up
        return res.status(404).json({ error: 'Result not ready or expired' });
      }
      const result = await responseHandler({ formId, userId: req.userId });
      if (!result) {
        return res.status(404).json({ error: 'Result not ready or expired' });
      }
      res.json({ status: 'ok', data: result });
    } catch (err) {
      logger.log('ERROR:', '[outgoing] POST /result', err);
      res.status(500).json({ error: err.message });
    }
  });
  router.get('/result', async (req, res) => {
    try {
      if (process.env.DEV_BYPASS_QUOTA === 'true') {
        // dev bypass: history lives in the DB — return an honest empty list
        return res.json({ status: 'ok', count: 0, data: [] });
      }
      const count = Math.min(parseInt(req.query.count, 10) || 10, 10);
      const [rows] = await pool.query(
        `SELECT submission_id, status, file_name, source, created_at
         FROM submissions
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [req.userId, count],
      );
      res.json({ status: 'ok', count: rows.length, data: rows });
    } catch (err) {
      logger.log('ERROR:', '[outgoing] GET /result', err);
      res.status(500).json({ error: err.message });
    }
  });
  return router;
}
