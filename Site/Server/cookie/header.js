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

export function headerCheck(req, res, next) {
  const userAgent = req.headers['user-agent'];
  if (!userAgent || typeof userAgent !== 'string' || userAgent.length < 5) {
    return res
      .status(400)
      .json({ status: 'rejected', reason: 'Missing or invalid User-Agent' });
  }
  const botPattern = /curl|wget|python|scrapy|bot|crawler|spider|headless/i;
  // DEV_BYPASS_SESSION lets a bot-shaped UA through so agents can exercise the
  // upload path with curl. Never active when NODE_ENV=production.
  if (botPattern.test(userAgent) && !sessionBypassEnabled()) {
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
