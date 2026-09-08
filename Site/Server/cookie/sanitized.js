import logger from '../../../Private/Bridge/logen.js';
import { pool } from '../db/db.js';
import { decodeCookie, encodeCookie } from './codec.js';
// devbypass.js is an OPTIONAL, removable module. Delete the file and this
// import resolves to the stub below, which means the gate simply stays
// ENFORCED — nothing throws, nothing else changes. Only DEV_BYPASS_SESSION
// lives in that module; DEV_BYPASS_IP / DEV_BYPASS_HEADER / DEV_BYPASS_QUOTA
// are read straight from process.env and keep their original behaviour with
// or without it.
//
// A MISSING module is the supported case and stays silent. A BROKEN one is a
// real bug, so anything other than "devbypass.js not found" is re-thrown.
let sessionBypassEnabled = () => false;
let devIdentity = () => null;
try {
  ({ sessionBypassEnabled, devIdentity } = await import('./devbypass.js'));
} catch (err) {
  const removed =
    err?.code === 'ERR_MODULE_NOT_FOUND' &&
    String(err.message).includes('devbypass');
  if (!removed) throw err;
}
export async function cookieDBCheck(req, res, next) {
  try {
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
    // ── DEV_BYPASS_SESSION ──────────────────────────────────────────────
    // Skips the users-table lookup (no DB on a dev box) WITHOUT discarding
    // the identity: a cookie sent by the caller is still decoded and used,
    // and a caller with no cookie runs as the one cookieGenerator just
    // minted for this request. So visitorHash / sessionId / userId are all
    // real values, not placeholders. Never active when NODE_ENV=production.
    if (sessionBypassEnabled()) {
      const sent = req.cookies.userData ? decodeCookie(req.cookies.userData) : null;
      if (sent?.userId) req.cookieData = sent;

      const identity = devIdentity(req);
      req.userId = identity.userId;
      req.user = identity.user;
      req.visitorHash = identity.visitorHash;
      req.cookieData = identity.cookieData;
      req.sessionId = identity.sessionId;
      req.devBypassSession = true;
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
