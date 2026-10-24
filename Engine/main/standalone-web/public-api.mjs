// Public API — two guarded routers in front of the engine tokenizer.
//
//   handshakeRouter (strict rate limit)  POST /handshake
//     Establishes the session<->engine binding: on success it GENERATES the
//     engine session hash (the YYYYMMDD_HHMMSS_mmm shape getDateTimeHash
//     mints in Bridge/logen.js) from this Express session and returns an
//     opaque handle. No client-supplied hash is ever trusted. One handshake
//     per session; repeats are 409.
//
//   guardedApi (standard rate limit)     /tokenizer/...
//     Handle-based read-back, valid only inside the session that minted it:
//       GET    /tokenizer                 handles owned by this session
//       GET    /tokenizer/:handle         handle metadata
//       GET    /tokenizer/:handle/raw      invokeWithHash (tagged text)
//       GET    /tokenizer/:handle/syllable invokeSyllableWithHash (positions)
//       DELETE /tokenizer/:handle         drop the mapping (read routes only)
//
// Every limiter buckets per client IP; the engine hash -> handle map lives
// ONLY in req.session, so a handle is meaningless outside its own session.
import express from 'express';
import crypto from 'node:crypto';
import { config } from './config.mjs';
import { createRateLimiter } from './rate-limit.mjs';

export const publicRouter = express.Router();
publicRouter.use(express.json({ limit: '16kb', strict: true }));

// tokenizer.js statically imports the Engine/main Bridge seam, which is not
// wired yet. Import it lazily (and cache the module) so the web process still
// boots; tokenizer read routes answer 503 until the Bridge exists.
let tokenizerModule = null;
async function loadTokenizer() {
  if (!tokenizerModule) tokenizerModule = await import('./tokenizer.js');
  return tokenizerModule;
}

// Engine hash generator — same contract as Bridge/logen.js getDateTimeHash(),
// mirrored here because the plugin cannot import the (unwired) Bridge. Shape
// must stay accepted by tokenizer.hashKind: /^\d{8}_\d{6}_\d{3}$/.
function mintEngineHash() {
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const p3 = (n) => String(n).padStart(3, '0');
  return (
    `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}` +
    `_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}_${p3(now.getMilliseconds())}`
  );
}

function sessionState(req) {
  if (!req.session.tokenizer) {
    req.session.tokenizer = { handshake: null, handles: {} };
  }
  return req.session.tokenizer;
}

function lookupHandle(req, res) {
  const entry = sessionState(req).handles[req.params.handle];
  if (!entry) {
    res.status(404).json({ error: 'unknown tokenizer handle for this session' });
    return null;
  }
  return entry;
}

// ── Guard 1: handshake, tight budget (mints the session hash). Route-scoped so
// the strict limiter only touches POST /handshake, never the tokenizer routes.
const handshakeLimit = createRateLimiter({
  windowMs: config.handshakeWindowMs,
  max: config.handshakeMax,
  name: 'handshake',
});

const handshakeRouter = express.Router();
handshakeRouter.post('/handshake', handshakeLimit, async (req, res, next) => {
  try {
    const state = sessionState(req);
    if (state.handshake) {
      return res.status(409).json({
        error: 'session already handshaken',
        handle: state.handshake.handle,
      });
    }

    const engineHash = mintEngineHash();
    const { hashKind } = await loadTokenizer();
    const kind = hashKind(engineHash); // self-check: the minted shape must validate
    if (kind !== 'engine') {
      return res.status(500).json({ error: 'minted engine hash failed its own shape check' });
    }

    const handle = crypto.randomBytes(16).toString('hex');
    const entry = { engineHash, kind, createdAt: Date.now() };
    state.handles[handle] = entry;
    state.handshake = { handle, engineHash, kind, createdAt: entry.createdAt };
    return res.status(201).json({ handle, kind, engineHash });
  } catch (err) {
    next(err);
  }
});

// ── Guard 2: tokenizer routes, standard budget. The limiter is mounted on the
// /tokenizer prefix only, so the handshake budget stays fully independent.
const apiLimit = createRateLimiter({
  windowMs: config.apiWindowMs,
  max: config.apiMax,
  name: 'api',
});

const guardedApi = express.Router();
guardedApi.use('/tokenizer', apiLimit);

guardedApi.get('/', (_req, res) =>
  res.status(200).json({ ok: true, api: 'public', endpoints: ['/handshake', '/tokenizer'] }),
);

guardedApi.get('/tokenizer', (req, res) =>
  res.status(200).json({ handshake: sessionState(req).handshake, handles: sessionState(req).handles }),
);

guardedApi.get('/tokenizer/:handle', (req, res) => {
  const entry = lookupHandle(req, res);
  if (!entry) return;
  return res.status(200).json({ handle: req.params.handle, ...entry });
});

// Tokenizer as a router: raw tagged text read-back.
guardedApi.get('/tokenizer/:handle/raw', async (req, res, next) => {
  try {
    const entry = lookupHandle(req, res);
    if (!entry) return;
    const { invokeWithHash } = await loadTokenizer();
    const text = await invokeWithHash(entry.engineHash);
    return res.status(200).json({
      handle: req.params.handle,
      hash: entry.engineHash,
      kind: entry.kind,
      text,
    });
  } catch (err) {
    next(err);
  }
});

// Positional syllable read-back (the public contract tokenizer.js documents:
// positions, never finished segmented text).
guardedApi.get('/tokenizer/:handle/syllable', async (req, res, next) => {
  try {
    const entry = lookupHandle(req, res);
    if (!entry) return;
    const { invokeSyllableWithHash } = await loadTokenizer();
    const positions = await invokeSyllableWithHash(entry.engineHash);
    return res.status(200).json({
      handle: req.params.handle,
      hash: entry.engineHash,
      kind: entry.kind,
      positions,
    });
  } catch (err) {
    next(err);
  }
});

guardedApi.delete('/tokenizer/:handle', (req, res) => {
  const state = sessionState(req);
  if (!state.handles[req.params.handle]) {
    return res.status(404).json({ error: 'unknown tokenizer handle for this session' });
  }
  delete state.handles[req.params.handle];
  if (state.handshake?.handle === req.params.handle) state.handshake = null;
  return res.status(200).json({ deleted: req.params.handle });
});

// Order matters: the strict handshake guard runs before anything else, and all
// tokenizer routes sit behind the standard guard.
publicRouter.use(handshakeRouter);
publicRouter.use(guardedApi);

// Engine seam failures (missing Bridge, missing output file) are 503/404,
// never a 200 with empty data.
publicRouter.use((err, _req, res, _next) => {
  if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') {
    return res.status(503).json({ error: 'tokenizer engine seam not wired (Bridge missing)' });
  }
  if (err?.code === 'ENOENT') {
    return res.status(404).json({ error: 'no engine output for the mapped hash' });
  }
  return res.status(err?.status ?? 500).json({ error: err?.message ?? 'tokenizer error' });
});
