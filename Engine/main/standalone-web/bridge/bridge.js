// Engine Bridge entry — temporary home inside the standalone-web plugin's
// bridge/ dir, mirroring the future Engine/main/Bridge/ layout.
//
// The real Engine/main/Bridge (path.js / logen.js / Ginit.js plus this entry)
// is built later; this file is the entry that will merge into it. The plugin
// is a small, removable directory, so nothing here edits engine-core files.
// When the real Bridge lands this moves verbatim into Engine/main/Bridge/.
//
// Caller routing — every call carries `signature`, the field that tells the
// bridge WHO is calling, plus that caller's own fields:
//
//   { signature: 'public',       hash, ... } -> path B, syllable-only segmenting
//   { signature: 'scraper',      hash, ... } -> path B, syllable-only segmenting
//   { signature: 'site',         ...job     } -> path A (full), RESERVED
//   { signature: 'proofreading', ...        } -> path A (full), RESERVED
//
// The two engine routines live in Engine/main/init/bridge.js:
//   path B  bridgeSyllable()  normalize -> runSegmentor -> syllable writer.
//           No POS tagger, no rule kernel — the tokenizer API only segments.
//   path A  bridge()          fullstopHolder -> runTagger -> runRuleEngine,
//           dual syllable/raw_pos writers. Its per-caller if-condition is
//           resolved in a later turn, so site/proofreading stay explicit
//           501 stubs rather than silently taking the wrong routine.
//
// STAGE OF THIS FILE: pre-routine sketch only. Input shapes, metadata
// contracts, read-back modes and engine sync/queueing are on the standalone-web
// revisit list — handlers only select the routine and await it.
//
// Adding a caller means adding one handler — nothing else changes.

// PLACEHOLDER: real specifier is Engine/main/init/bridge.js; kept named this
// way until the Engine/main/Bridge shims (path/logen/Ginit) resolve, matching
// the placeholder convention already used in engine-runner.mjs.
const ENGINE_BRIDGE = './placeholderFor-Engine-main-init-bridge.js';

export class BridgeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
  }
}

/* ── Path B: syllable-only pre-routine (3-line sketch) ─────────────────────
   The segmentor generator and writeFlags/hash/inputPath argument shape are
   finalised with the metadata revisit; bridgeSyllable already owns the
   normalize -> runSegmentor -> writer assembly internally. */
async function pathBSyllable(fields = {}) {
  const { bridgeSyllable } = await import(ENGINE_BRIDGE);
  return bridgeSyllable(fields.seg, { syllable: true }, fields.hash, fields.inputPath);
}

/* ── Path A: full tagger/kernel pre-routine (reserved sketch) ──────────────
   Full routine exists in init/bridge.js as bridge(); which caller may run it
   and under what flags is the if-condition deferred to the next turn. */
async function pathAFull(_fields = {}) {
  throw new BridgeError('path A (full tagger/kernel routine) is reserved for site/proofreading and not wired yet', 501);
}

const handlers = {
  // Rate-limited public tokenizer API: segmenting only, so it always takes B.
  public: (fields) => pathBSyllable(fields),
  // Local library caller (scraper): same syllable-only guarantee, same path.
  scraper: (fields) => pathBSyllable(fields),
  // HTTP caller from the Site: full routine later; refuse rather than guess.
  site: (fields) => pathAFull(fields),
  // Local proofreading quality work: needs both views; full routine later.
  proofreading: (fields) => pathAFull(fields),
};

// Which engine routine each signature is contracted to. Exported so callers
// and tests can assert routing without invoking a placeholder import.
export const CALLER_PATHS = Object.freeze({
  public: 'B',
  scraper: 'B',
  site: 'A',
  proofreading: 'A',
});

/**
 * Single bridge entry point. Callers pass their signature + fields and await
 * the result; read-back happens inside the selected routine.
 */
export async function bridgeInvoke({ hash, signature, ...fields } = {}) {
  if (typeof hash !== 'string' || !hash) {
    throw new BridgeError('bridge: hash is required');
  }
  if (typeof signature !== 'string' || !signature) {
    throw new BridgeError('bridge: signature is required');
  }
  const handler = handlers[signature];
  if (!handler) {
    throw new BridgeError(`bridge: unknown signature '${signature}'`, 404);
  }
  return handler({ hash, ...fields });
}
