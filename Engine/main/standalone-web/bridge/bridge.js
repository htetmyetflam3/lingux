// Engine Bridge internals — routine selection for the sole public entry
// BindEngine in ./bind-engine.js.
//
// This module deliberately exports NO callable entry of its own: callers
// import BindEngine (the WASM-shaped single entry) and the signature string
// decides everything here. Reaching around BindEngine into these handlers
// corrupts the boundary design. This file moves verbatim into the future
// Engine/main/Bridge/ together with bind-engine.js.
//
// Caller routing — the signature BindEngine receives selects the routine:
//
//   'public'       -> path B, syllable-only segmenting
//   'scraper'      -> path B, syllable-only segmenting
//   'site'         -> path A (full), RESERVED — quiet string refusal
//   'proofreading' -> path A, bridge() two-file form
//   'debugger'     -> path A, bridgeDebug() five-file debug form
//
// The engine routines live in Engine/main/init/bridge.js:
//   path B  bridgeSyllable()  normalize -> runSegmentor -> syllable writer.
//           No POS tagger, no rule kernel — the tokenizer API only segments.
//   path A  bridge()          fullstopHolder -> runTagger -> runRuleEngine
//           (pass-through kernel), dual syllable/raw_pos writers — the
//           proofreading caller's current two-file output.
//           bridgeDebug()     the same chain incl. the same kernel, plus the
//           runIdMapper observability stage: five hardcoded outputs
//           (syllable, raw_pos, ids, id_mapper, id_merged) for the debugger
//           caller only — a rare-event mapping safety net, never a daily run.
//           site's if-condition is still deferred, so it stays an explicit
//           refusal rather than silently taking the wrong routine.
//
// Throws are plain strings, quiet by contract: BindEngine owns the boundary
// and the express layer turns them into refusal responses.
//
// STAGE: pre-routine sketch. Input shapes, metadata contracts, read-back
// modes and engine sync/readiness are on the standalone-web revisit list —
// handlers only select the routine and await it.

// PLACEHOLDER: real specifier is Engine/main/init/bridge.js; kept named this
// way until the Engine/main/Bridge shims (path/logen/Ginit) resolve, matching
// the placeholder convention already used in engine-runner.mjs.
const ENGINE_BRIDGE = './placeholderFor-Engine-main-init-bridge.js';

/* ── Path B: syllable-only pre-routine (3-line sketch) ─────────────────────
   The segmentor generator and hash/inputPath argument shape are finalised
   with the metadata revisit; bridgeSyllable already owns the normalize ->
   runSegmentor -> writer assembly internally. */
async function pathBSyllable(fields = {}) {
  const { bridgeSyllable } = await import(ENGINE_BRIDGE);
  return bridgeSyllable(fields.seg, { syllable: true }, fields.hash, fields.inputPath);
}

/* ── Path A: full tagger/kernel pre-routine ────────────────────────────────
   proofreading takes the production two-file form (bridge(): syllable +
   raw_pos). The argument shape is finalised with the metadata revisit;
   bridge() owns the fullstopHolder -> runTagger -> runRuleEngine assembly
   and the pass-through kernel internally. */
async function pathAFull(fields = {}) {
  const { bridge } = await import(ENGINE_BRIDGE);
  return bridge(fields.seg, { syllable: true, rawPos: true }, fields.hash, fields.inputPath);
}

/* ── Path A debug: the Staging five-output observability form ──────────────
   debugger takes bridgeDebug() — the same chain and pass-through kernel as
   bridge() plus runIdMapper, always writing all five files. writeFlags is
   hardcoded inside the routine; no flags travel across this boundary. */
async function pathADebug(fields = {}) {
  const { bridgeDebug } = await import(ENGINE_BRIDGE);
  return bridgeDebug(fields.seg, null, fields.hash, fields.inputPath);
}

/* site's if-condition is still deferred: refuse rather than guess a routine. */
async function pathAReserved(_fields = {}) {
  throw 'bridge: site path A routine is not wired yet';
}

// Internal dispatch table — BindEngine is the only importer. Adding a caller
// means adding one handler here, nothing else changes.
export const handlers = Object.freeze({
  // Rate-limited public tokenizer API: segmenting only, so it always takes B.
  public: (fields) => pathBSyllable(fields),
  // Local library caller (scraper): same syllable-only guarantee, same path.
  scraper: (fields) => pathBSyllable(fields),
  // HTTP caller from the Site: full routine later; refuse rather than guess.
  site: (fields) => pathAReserved(fields),
  // Local proofreading quality work: current two-file path-A output.
  proofreading: (fields) => pathAFull(fields),
  // Rare-event mapping inspection: five-file debug form, same kernel.
  debugger: (fields) => pathADebug(fields),
});

// Which engine routine each signature is contracted to. Internal contract
// table for readability; not exported — BindEngine is the only public entry.
const CALLER_PATHS = Object.freeze({
  public: 'B',
  scraper: 'B',
  site: 'A',
  proofreading: 'A',
  debugger: 'A',
});
