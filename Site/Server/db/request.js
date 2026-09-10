import crypto from 'crypto';
import { agentUploadEnabled } from '../cookie/devbypass.js';

// Dev bypass: with DEV_BYPASS_QUOTA=true (already in .env) the whole
// request layer runs DB-free — the /api/submit chain can be developed and
// tested end-to-end without MySQL. Disk output (.output/txt, .output/original,
// quarantine) still happens exactly as in production; only the users /
// submissions writes are skipped.
// ALLOW_AGENT_UPLOAD=true (the master) engages the same DB-free path.
const devBypass = () =>
  process.env.DEV_BYPASS_QUOTA === 'true' || agentUploadEnabled();

export function createRequest({ pool }) {
  return {
    async validateSession({ userId, visitorHash }) {
      const [rows] = await pool.query(
        'SELECT id, daily_quota_used, daily_quota_reset FROM users WHERE id = ? AND cookie_hash = ?',
        [userId, visitorHash],
      );
      if (!rows.length) throw new Error('Session metadata mismatch');
      return rows[0];
    },
    async createUploadSession({ userId, visitorHash, source }) {
      const formId = crypto.randomUUID();
      if (devBypass()) return formId; // no INSERT — formId is still real
      await pool.query(
        `INSERT INTO submissions
				(submission_id, user_id, session_id, source, status, created_at)
				VALUES (?, ?, ?, ?, ?, NOW())`,
        [formId, userId, visitorHash, source, 'pending'],
      );
      return formId;
    },
    async validateSubmission({ userId, formId, source }) {
      if (devBypass() || source === 'new')
        return {
          userId,
          formId,
          source,
          owned: true,
        };
      const [rows] = await pool.query(
        'SELECT id FROM submissions WHERE user_id = ? AND submission_id = ?',
        [userId, formId],
      );
      if (!rows.length) throw new Error('Submission metadata mismatch');
      return {
        userId,
        formId,
        source,
        owned: true,
      };
    },
    async getUploadMetadata({ userId, formId }) {
      const [rows] = await pool.query(
        'SELECT * FROM submissions WHERE user_id = ? AND submission_id = ?',
        [userId, formId],
      );
      if (!rows.length) throw new Error('Upload metadata not found');
      return rows[0];
    },
    async checkQuota({ userId }) {
      if (devBypass()) {
        return { allowed: true, remaining: 999 };
      }
      const today = new Date().toISOString().split('T')[0];
      const [rows] = await pool.query(
        'SELECT daily_quota_used, daily_quota_reset FROM users WHERE id = ?',
        [userId],
      );
      if (!rows.length)
        return {
          allowed: false,
          reason: 'User not found',
        };
      const user = rows[0];
      const resetDate = user.daily_quota_reset
        ? user.daily_quota_reset.toISOString().split('T')[0]
        : null;
      if (resetDate !== today) {
        await pool.query(
          'UPDATE users SET daily_quota_used = 0, daily_quota_reset = NOW() WHERE id = ?',
          [userId],
        );
        return {
          allowed: true,
          remaining: 3,
        };
      }
      if (user.daily_quota_used >= 3) {
        return {
          allowed: false,
          remaining: 0,
        };
      }
      return {
        allowed: true,
        remaining: 3 - user.daily_quota_used,
      };
    },
    async incrementQuota({ userId }) {
      if (devBypass()) return;
      await pool.query(
        'UPDATE users SET daily_quota_used = daily_quota_used + 1 WHERE id = ?',
        [userId],
      );
    },
    async finalizeUpload({
      userId,
      // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
      visitorHash,
      formId,
      submitId,
      filename,
      bridgePath,
      originalName,
    }) {
      if (devBypass()) return; // no UPDATE — .output is already on disk
      await pool.query(
        `UPDATE submissions
				SET status      = ?,
				file_name   = ?,
				submit_id   = ?,
				bridge_path = ?,
				updated_at  = NOW()
				WHERE submission_id = ? AND user_id = ?`,
        [
          'processed',
          originalName || filename,
          submitId,
          bridgePath,
          formId,
          userId,
        ],
      );
    },
  };
}
