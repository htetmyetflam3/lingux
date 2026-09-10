import logger from '../../../Private/Bridge/logen.js';
import { LOGS_DIR } from '../../Public/_file/paths.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createOrUpdateCookie } from '../db/cookie.js';
import { encodeCookie, decodeCookie } from './codec.js';
import { sessionBypassEnabled, agentUploadEnabled } from './devbypass.js';
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
    if (sessionBypassEnabled() || agentUploadEnabled()) {
      // Dev bypass: no DB — but the identity itself stays real (visitor uuid,
      // localStorageToken carried inside the encoded cookie), so a round trip
      // sees the same visitor as it would with the DB upsert.
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
