import logger from '../../../Private/Bridge/logen.js';
import { LOGS_DIR } from '../../Public/_file/paths.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createOrUpdateCookie } from '../db/cookie.js';
import { encodeCookie, decodeCookie } from './codec.js';
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
try {
  ({ sessionBypassEnabled } = await import('./devbypass.js'));
} catch (err) {
  const removed =
    err?.code === 'ERR_MODULE_NOT_FOUND' &&
    String(err.message).includes('devbypass');
  if (!removed) throw err;
}
const logDir = LOGS_DIR;
fs.mkdirSync(logDir, { recursive: true });
function safeLog(filename, data) {
  try {
    fs.appendFileSync(path.join(logDir, filename), data);
  } catch {} // eslint-disable-line no-empty
}
function hashFingerprint(ip, ua, country) {
  const raw = `${ip}::${ua}::${country}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}
export const cookieGenerator = async (req, res, next) => {
  try {
    const cfHeader =
      req.headers['cf-connecting-ip'] ||
      req.trustedIp ||
      req.socket?.remoteAddress ||
      '192.168.100.1';
    const cfCountry = req.headers['cf-ipcountry'] || 'MM';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const timestampNow = new Date();
    const nowIso = timestampNow.toISOString();
    let cookieData;
    let isNew = false;
    if (!req.cookies.userData) {
      const localStorageToken = crypto.randomBytes(16).toString('hex');
      const visitorId = crypto.randomUUID();
      cookieData = {
        userId: visitorId,
        cfHeader,
        cfCountry,
        userAgent,
        timestamp: nowIso,
        t: 0,
        localStorageToken,
      };
      isNew = true;
      safeLog('cookie.log', `[${nowIso}] CREATED: ${visitorId}\n`);
    } else {
      try {
        cookieData = decodeCookie(req.cookies.userData);
        if (!cookieData || !cookieData.userId) throw new Error('bad');
        if (
          new Date(cookieData.timestamp).toDateString() !==
          timestampNow.toDateString()
        ) {
          cookieData.t = 0;
        }
        cookieData.timestamp = nowIso;
        safeLog(
          'cookie-updates.log',
          `[${nowIso}] UPDATED: ${cookieData.userId}\n`,
        );
      } catch {
        const localStorageToken = crypto.randomBytes(16).toString('hex');
        const visitorId = crypto.randomUUID();
        cookieData = {
          userId: visitorId,
          cfHeader,
          cfCountry,
          userAgent,
          timestamp: nowIso,
          t: 0,
          localStorageToken,
        };
        // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
        isNew = true;
        safeLog('cookie.log', `[${nowIso}] REGENERATED (parse fail)\n`);
      }
    }
    const deviceFingerprint = hashFingerprint(cfHeader, userAgent, cfCountry);
    cookieData.deviceFingerprint = deviceFingerprint;
    const bypassIp = process.env.DEV_BYPASS_IP || '';
    const isBypass =
      bypassIp && (cfHeader === bypassIp || cfHeader === '::ffff:' + bypassIp);
    if (isBypass) {
      cookieData.dbUserId = 1;
      safeLog('cookie.log', `[${nowIso}] BYPASS_IP ${cfHeader} (no DB call)\n`);
    } else if (sessionBypassEnabled()) {
      // DEV_BYPASS_SESSION: the cookie is still built, encoded and returned —
      // only the users-table upsert is skipped, because the sandbox/dev box has
      // no DB reachable. Never active when NODE_ENV=production.
      cookieData.dbUserId = 1;
      safeLog(
        'cookie.log',
        `[${nowIso}] BYPASS_SESSION ${cookieData.userId} (no DB call)\n`,
      );
    } else {
      const dbUserId = await createOrUpdateCookie({
        ...cookieData,
        deviceFingerprint,
        localStorageToken: cookieData.localStorageToken,
      });
      cookieData.dbUserId = dbUserId;
    }
    const encoded = encodeCookie(cookieData);
    res.cookie('userData', encoded, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 15 * 24 * 60 * 60 * 1000,
    });
    res.setHeader('X-Visitor-Token', cookieData.localStorageToken);
    req.visitorHash = cookieData.userId;
    req.cookieData = cookieData;
    next();
  } catch (err) {
    logger.log('ERROR:', '[CookieGenerator]', err);
    res.status(500).json({ status: 'error', reason: 'Cookie handling failed' });
  }
};
