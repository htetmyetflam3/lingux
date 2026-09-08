import logger from '../../../Private/Bridge/logen.js';
import { Router } from 'express';
import { createOutgoingResponseHandler } from '../proxy/responseHandler.js';
export function createOutgoingRouter({ pool, request }) {
  const responseHandler = createOutgoingResponseHandler({ pool });
  const router = Router();
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
