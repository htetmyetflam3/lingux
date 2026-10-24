// Public API — session-scoped access to the engine tokenizer.
//
// The tokenizer (tokenizer.js) reads engine output files keyed by the ENGINE
// session hash (segmented_{hash}_*.txt). A public caller never sees that hash
// directly: it registers the engine hash once against its Express session and
// receives an opaque handle. All later reads are handle-based, and the
// engine hash -> handle mapping lives ONLY in req.session, so a handle is
// meaningless outside the session that minted it.
//
//   POST   /tokenizer/register        { hash }            -> { handle, kind }
//   GET    /tokenizer                 -> handles owned by this session
//   GET    /tokenizer/:handle         -> handle metadata
//   GET    /tokenizer/:handle/raw      -> invokeWithHash (tagged text)
//   GET    /tokenizer/:handle/syllable -> invokeSyllableWithHash (positions)
//   DELETE /tokenizer/:handle         -> drop the mapping
import express from 'express';
import crypto from 'node:crypto';

export const publicRouter = express.Router();
publicRouter.use(express.json({ limit: '16kb', strict: true }));

// tokenizer.js statically imports the Engine/main Bridge seam, which is not
// wired yet. Import it lazily (and cache the module) so the web process still
// boots; tokenizer routes answer 503 until the Bridge exists.
let tokenizerModule = null;
async function loadTokenizer() {
  if (!tokenizerModule) tokenizerModule = await import('./tokenizer.js');
  return tokenizerModule;
}

function handlesOf(req) {
  if (!req.session.tokenizer) req.session.tokenizer = { handles: {} };
  return req.session.tokenizer.handles;
}

function lookupHandle(req, res) {
  const entry = handlesOf(req)[req.params.handle];
  if (!entry) {
    res.status(404).json({ error: 'unknown tokenizer handle for this session' });
    return null;
  }
  return entry;
}

publicRouter.get('/', (_req, res) =>
  res.status(200).json({ ok: true, api: 'public', endpoints: ['/tokenizer'] }),
);

// Map an engine session hash onto this Express session. hashKind() is the
// tokenizer's own gate: engine timestamp / uuid / 32-hex session id, else refuse.
publicRouter.post('/tokenizer/register', async (req, res, next) => {
  try {
    const hash = String(req.body?.hash ?? '').trim();
    const { hashKind } = await loadTokenizer();
    const kind = hashKind(hash);
    if (!kind) {
      return res
        .status(400)
        .json({ error: 'hash must be an engine timestamp, uuid, or 32-hex session id' });
    }
    const handle = crypto.randomBytes(16).toString('hex');
    handlesOf(req)[handle] = { engineHash: hash, kind, createdAt: Date.now() };
    return res.status(201).json({ handle, kind, engineHash: hash });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/tokenizer', (req, res) =>
  res.status(200).json({ handles: handlesOf(req) }),
);

publicRouter.get('/tokenizer/:handle', (req, res) => {
  const entry = lookupHandle(req, res);
  if (!entry) return;
  return res.status(200).json({ handle: req.params.handle, ...entry });
});

// Tokenizer as a router: raw tagged text read-back.
publicRouter.get('/tokenizer/:handle/raw', async (req, res, next) => {
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
publicRouter.get('/tokenizer/:handle/syllable', async (req, res, next) => {
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

publicRouter.delete('/tokenizer/:handle', (req, res) => {
  const handles = handlesOf(req);
  if (!handles[req.params.handle]) {
    return res.status(404).json({ error: 'unknown tokenizer handle for this session' });
  }
  delete handles[req.params.handle];
  return res.status(200).json({ deleted: req.params.handle });
});

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
