import logger from '../../../Private/Bridge/logen.js';
import { pool } from '../db/db.js';
import { decodeCookie, encodeCookie } from './codec.js';
import {
  sessionBypassEnabled,
  agentUploadEnabled,
  devIdentity,
} from './devbypass.js';
export async function cookieDBCheck(req, res, next) {
  try {
    // DEV_BYPASS_SESSION: no users lookup — the DB is not available in dev.
    // Identity still comes from the real cookie cookieGenerator just built or
    // decoded (same visitor uuid a browser would carry), so a round trip sees
    // the same visitor signature on both sides.
    if (sessionBypassEnabled() || agentUploadEnabled()) {
      const identity = devIdentity(req);
      req.userId = identity.userId;
      req.user = identity.user;
      req.visitorHash = identity.visitorHash;
      req.cookieData = identity.cookieData;
      return next();
    }
    const reqIp = req.trustedIp || req.socket?.remoteAddress || '';
    const bypassIp = process.env.DEV_BYPASS_IP || '';
    const isBypass =
      bypassIp && (reqIp === bypassIp || reqIp === '::ffff:' + bypassIp);
    if (isBypass) {
      req.userId = 1;
      req.user = { id: 1, cookie_hash: 'bypass', t: 0, daily_quota_used: 0 };
      req.visitorHash = 'bypass-visitor';
      req.cookieData = {
        userId: 'bypass-visitor',
        timestamp: new Date().toISOString(),
      };
      return next();
    }
    const rawCookie = req.cookies.userData;
    if (!rawCookie) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const parsed = decodeCookie(rawCookie);
    if (!parsed || !parsed.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const cookieHash = parsed.userId;
    const [rows] = await pool.query(
      'SELECT id, cookie_hash, t, last_submission_date FROM users WHERE cookie_hash = ?',
      [cookieHash],
    );
    if (rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const user = rows[0];
    parsed.timestamp = new Date().toISOString();
    res.cookie('userData', encodeCookie(parsed), {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 15 * 24 * 60 * 60 * 1000,
    });
    req.userId = user.id;
    req.user = user;
    req.visitorHash = cookieHash;
    req.cookieData = parsed;
    next();
  } catch (err) {
    logger.log('ERROR:', '[cookieDBCheck]', err);
    res.status(500).json({ error: 'Internal error' });
  }
}
