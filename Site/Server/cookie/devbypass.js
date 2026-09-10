// FILE: Server/cookie/devbypass.js
//
// TEMPORARY, DEVELOPMENT-ONLY bypass for the cookie + session gate.
//
// Why this exists
// ───────────────
// The /api stack is deliberately hostile to curl. Three separate gates stop it:
//
//   1. headerCheck    — rejects any bot-shaped User-Agent (curl|wget|python|…)
//   2. cookieGenerator— needs the DB to upsert the visitor row
//   3. cookieDBCheck  — needs a real userData cookie AND a matching users row
//
// DEV_BYPASS_QUOTA already makes the whole request/quota layer DB-free, and
// DEV_BYPASS_IP/DEV_BYPASS_HEADER cover the IP and country checks — but nothing
// opens gate 1 or gate 3, so an agent testing an upload over curl gets a 403
// before a single byte of the pipeline runs.
//
// DEV_BYPASS_SESSION opens exactly those two gates and nothing else.
//
// What it does NOT do
// ───────────────────
// It does not fabricate an anonymous identity when a real one is available:
// the cookie is still generated, decoded and carried, and the session id is
// still minted by express-session. The gate stops *rejecting*; it does not stop
// *working*. Everything downstream (visitorHash, session id, userId) receives a
// real value, so anything derived from those three later behaves the same as it
// does for a browser.
//
// PRODUCTION
// ──────────
// This can never be on in production. enabled() hard-returns false whenever
// NODE_ENV === 'production', regardless of the env var — so shipping a stray
// DEV_BYPASS_SESSION=true in a live .env is inert, not a hole. index.js prints a
// loud warning at boot in both cases (on in dev / ignored in prod).
//
// MASTER SWITCH
// ─────────────
// ALLOW_AGENT_UPLOAD=true opens every gate at once — headerCheck (bot UAs
// included), cookieGenerator's visitor upsert, cookieDBCheck's cookie→users
// lookup, the MemoryStore session, the request/quota layer, and the hidden
// raw disk-resolve. It duplicates today's all-flags-on behavior in one flag
// for agents, and like SESSION it fail-closes under NODE_ENV=production.
// The specific DEV_BYPASS_* flags are untouched and independent: each opens
// only its own layer, so one layer (e.g. quota) can be tested with the rest
// still enforced. Separate checks, not a single fraud system.

const FLAG = 'DEV_BYPASS_SESSION';
const MASTER = 'ALLOW_AGENT_UPLOAD';

/** Is the cookie+session bypass active for this process? Never true in production. */
export function sessionBypassEnabled() {
  if (process.env.NODE_ENV === 'production') return false; // fail closed
  return process.env[FLAG] === 'true';
}

/** True when the flag was set but is being ignored because this is production. */
export function sessionBypassIgnored() {
  return process.env.NODE_ENV === 'production' && process.env[FLAG] === 'true';
}

/**
 * The identity a bypassed request runs as.
 *
 * Prefers the identity cookieGenerator just built (req.cookieData) so the
 * request carries a real visitor uuid and a real session id; only falls back to
 * fixed dev constants when there is genuinely nothing to read.
 */
export function devIdentity(req) {
  const cookieData = req.cookieData || null;
  const visitorHash = cookieData?.userId || 'dev-bypass-visitor';

  return {
    // numeric users.id stand-in — same value the DEV_BYPASS_IP path uses
    userId: cookieData?.dbUserId || 1,
    visitorHash,
    sessionId: req.sessionID || req.session?.id || null,
    user: {
      id: cookieData?.dbUserId || 1,
      cookie_hash: visitorHash,
      t: 0,
      daily_quota_used: 0,
    },
    cookieData: cookieData || {
      userId: visitorHash,
      timestamp: new Date().toISOString(),
    },
  };
}

/** One-line boot banner, or null when there is nothing to say. */
export function sessionBypassBanner() {
  if (sessionBypassIgnored()) {
    return `[devbypass] ${FLAG}=true IGNORED — NODE_ENV=production. Cookie/session gate is ENFORCED.`;
  }
  if (sessionBypassEnabled()) {
    return `[devbypass] ${FLAG}=true — cookie/session gate OPEN and bot User-Agents ALLOWED. Development only.`;
  }
  return null;
}

/** Is the allow-all master active? Never true in production. */
export function agentUploadEnabled() {
  if (process.env.NODE_ENV === 'production') return false; // fail closed
  return process.env[MASTER] === 'true';
}

/** True when the master was set but is being ignored (production). */
export function agentUploadIgnored() {
  return process.env.NODE_ENV === 'production' && process.env[MASTER] === 'true';
}

/** One-line boot banner for the master, or null when silent. */
export function agentUploadBanner() {
  if (agentUploadIgnored()) {
    return `[devbypass] ${MASTER}=true IGNORED — NODE_ENV=production. Every gate is ENFORCED.`;
  }
  if (agentUploadEnabled()) {
    return `[devbypass] ${MASTER}=true — every gate OPEN (header + cookie + quota + hidden raw). Development only.`;
  }
  return null;
}
