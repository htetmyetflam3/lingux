import { sessionBypassEnabled } from './devbypass.js';

export function headerCheck(req, res, next) {
  // DEV_BYPASS_SESSION: open the gate for automated clients (curl) in dev.
  // Trusted-IP resolution still runs — everything downstream expects it.
  if (sessionBypassEnabled()) {
    req.trustedIp =
      req.headers['cf-connecting-ip'] ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';
    return next();
  }
  const userAgent = req.headers['user-agent'];
  if (!userAgent || typeof userAgent !== 'string' || userAgent.length < 5) {
    return res
      .status(400)
      .json({ status: 'rejected', reason: 'Missing or invalid User-Agent' });
  }
  const botPattern = /curl|wget|python|scrapy|bot|crawler|spider|headless/i;
  if (botPattern.test(userAgent)) {
    return res
      .status(403)
      .json({ status: 'rejected', reason: 'Automated access denied' });
  }
  req.trustedIp =
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  const bypassHeader = process.env.DEV_BYPASS_HEADER === 'true';
  const bypassIp = process.env.DEV_BYPASS_IP || '';
  const reqIp = req.socket?.remoteAddress || '';
  const isBypassIp =
    bypassIp && (reqIp === bypassIp || reqIp === '::ffff:' + bypassIp);
  if (!bypassHeader && !isBypassIp) {
    const cfCountry =
      req.headers['cf-ipcountry'] || req.headers['x-verified-country'];
    if (!cfCountry || cfCountry !== 'MM') {
      return res
        .status(403)
        .json({ status: 'rejected', reason: 'Access restricted to Myanmar' });
    }
  }
  next();
}
