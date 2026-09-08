import crypto from 'crypto';

// Dev bypass: with DEV_BYPASS_QUOTA=true (already in .env) the whole
// request layer runs DB-free — the /api/submit chain can be developed and
// tested end-to-end without MySQL. Disk output (.output/txt, .output/original,
// quarantine) still happens exactly as in production; only the users /
// submissions writes are skipped.
const devBypass = () => process.env.DEV_BYPASS_QUOTA === 'true';

// Daily submissions allowed per anonymous/free visitor.
//
// This is an ANTI-SPAM limit, not a billing plan: it exists so one visitor
// cannot hammer the pipeline all day. Identity here is the blackbox
// session/cookie hash, which is why the number is small.
//
// Configurable via FREE_DAILY_QUOTA so it can be raised for testing without a
// code change. A future account-based tier would supply its own allowance;
// nothing in the save gate cares what the number is or where it came from —
// getQuota() reports it and commitSubmission() charges one unit against it.
function readDailyQuota() {
  const raw = process.env.FREE_DAILY_QUOTA;
  if (raw === undefined || raw === '') return 3;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : 3;
}
export const DAILY_QUOTA = readDailyQuota();

export function createRequest({ pool }) {
  return {
    /**
     * READ-ONLY quota status, for the frontend to ask BEFORE the user commits
     * to a submission.
     *
     * Deliberately does not write: checkQuota() rolls the daily counter over
     * with an UPDATE when the reset date has passed, but a status read must
     * never mutate. It reports the rolled-over value instead and lets the next
     * real submission persist it.
     */
    async getQuota({ userId }) {
      if (devBypass()) {
        return {
          allowed: true,
          used: 0,
          limit: DAILY_QUOTA,
          remaining: DAILY_QUOTA,
          resetAt: null,
          bypass: true,
        };
      }
      const [rows] = await pool.query(
        'SELECT daily_quota_used, daily_quota_reset FROM users WHERE id = ?',
        [userId],
      );
      if (!rows.length) {
        return {
          allowed: false,
          used: 0,
          limit: DAILY_QUOTA,
          remaining: 0,
          resetAt: null,
          reason: 'User not found',
        };
      }
      const today = new Date().toISOString().split('T')[0];
      const resetDate = rows[0].daily_quota_reset
        ? rows[0].daily_quota_reset.toISOString().split('T')[0]
        : null;
      // Same rule checkQuota() applies — a stale reset date means the counter
      // is already spent, it just has not been written back yet.
      const used = resetDate !== today ? 0 : rows[0].daily_quota_used;
      const remaining = Math.max(DAILY_QUOTA - used, 0);
      return {
        allowed: remaining > 0,
        used,
        limit: DAILY_QUOTA,
        remaining,
        resetAt: rows[0].daily_quota_reset || null,
        bypass: false,
      };
    },
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
      if (process.env.DEV_BYPASS_QUOTA === 'true') {
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
          remaining: DAILY_QUOTA,
        };
      }
      if (user.daily_quota_used >= DAILY_QUOTA) {
        return {
          allowed: false,
          remaining: 0,
        };
      }
      return {
        allowed: true,
        remaining: DAILY_QUOTA - user.daily_quota_used,
      };
    },
    async incrementQuota({ userId }) {
      if (process.env.DEV_BYPASS_QUOTA === 'true') return;
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

    /**
     * THE SAVE GATE — record the submission and charge the quota as ONE
     * atomic unit.
     *
     * Called once, at the moment the raw .txt exists on disk. Both writes
     * land or neither does:
     *
     *   commit   → the row says 'processed' AND the user was charged
     *   rollback → neither happened, so the user is not billed for a
     *              submission the database never recorded
     *
     * The .txt cannot join the transaction (it is a file, not a row). If the
     * transaction rolls back, that file is left orphaned on disk — the
     * harmless direction: an unreferenced artifact nobody paid for, rather
     * than a charge with nothing to show for it.
     *
     * Replaces the finalizeUpload() + incrementQuota() pair at the call site;
     * both remain above as the individual operations.
     */
    async commitSubmission({
      userId,
      // eslint-disable-next-line no-unused-vars -- kept for parity with finalizeUpload
      visitorHash,
      formId,
      submitId,
      filename,
      bridgePath,
      originalName,
    }) {
      if (devBypass()) {
        // .output is already on disk; nothing to record, nothing to charge.
        return { committed: false, charged: false, bypass: true };
      }

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        await conn.query(
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

        // Charged in the same transaction as the row it pays for.
        await conn.query(
          'UPDATE users SET daily_quota_used = daily_quota_used + 1 WHERE id = ?',
          [userId],
        );

        await conn.commit();
        return { committed: true, charged: true, bypass: false };
      } catch (err) {
        try {
          await conn.rollback();
        } catch {
          /* rollback is best-effort; the original error is what matters */
        }
        throw err;
      } finally {
        conn.release();
      }
    },
  };
}
