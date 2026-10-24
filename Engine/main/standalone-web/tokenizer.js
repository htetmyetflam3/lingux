/* ═══════════════════════════════════════════════════════════════
   Module A – API Caller
   Reads:     a session hash from an external caller
   Processes: constructs the raw_pos filename from that hash
   Outputs:   delegates to Module B and returns the file text
   ═══════════════════════════════════════════════════════════════ */

// Engine deps are imported lazily: the Bridge seam (../Bridge/path.js) is not
// wired yet, and hashKind() below needs none of them. Lazy imports let the web
// process load this module and maintain the session<->hash map; only actual
// output read-back fails until the Bridge exists.
let engineDeps = null;
async function engine() {
  if (!engineDeps) {
    const [path, stream, formatter] = await Promise.all([
      import('../Bridge/path.js'),
      import('../MonoSyllabism/utilities/stream.js'),
      import('../MonoSyllabism/utilities/formatter.js'),
    ]);
    engineDeps = { path, stream, formatter };
  }
  return engineDeps;
}

/**
 * Accept a hash, build the segmented_{hash}_raw_pos.txt path,
 * and ask Module B to read it.
 * @param {string} hash
 * @returns {Promise<string>} full file content
 */
export async function invokeWithHash(hash) {
  const { path, stream } = await engine();
  const filename = `segmented_${hash}_raw_pos.txt`;
  const filePath = path.joinPath(path.OutputFile(), filename);
  return await stream.readFileContent(filePath);
}

/* ── Positional syllable API ─────────────────────────────────────
   The public API does NOT hand back ready-made segmented text.
   It hands back positions; the caller writes the segmentation.

   Scope: Burmese only. Punctuation, English words, digits and
   duplicate marks are the caller's problem — we never promised to
   clean their text. We clean it for OURSELVES, because we have to in
   order to segment at all.

     our syllable output   hello  နေ  ကောင်း  လား
     response              { index: "န", syllable: ["1", "5", "2"] }

   index is the first Burmese base consonant. The caller finds that
   char in its own text and walks: take 1 after န → နေ, move to the
   next base consonant က, take 5 → ကောင်း, move to လ, take 2 → လား.

   Consuming the count BEFORE searching again is what makes this work:
   င inside ကောင်း is itself a base consonant, and gets stepped over.

   IMPORTANT — the positions are measured against our CLEAN output,
   not the caller's raw text. normalize() (map-runtime.jsc)
   NFC-folds, drops Glue and $ # ^ { }, reorders marks by Priority,
   rewrites imposter lookalikes and collapses runs of spaces. So a
   caller holding duplicate spaces, duplicate marks or imposter chars
   will NOT line up exactly. That is deliberate: this API is for
   callers who do their own work, not for consumers who want finished
   Burmese NLP output handed to them. Do not "fix" this by returning
   segmented text.
   ─────────────────────────────────────────────────────────────── */

/** isBase / toPositions are not defined here — they are the positional
   syllable contract, owned by knowledge/library/formatter.js. */

/**
 * Accept a hash, read segmented_{hash}_syllable.txt, and return the
 * syllable boundaries as positions — one entry per line that has
 * Burmese in it.
 * @param {string} hash
 * @returns {Promise<Array<{index: string, syllable: string[]}>>}
 */
export async function invokeSyllableWithHash(hash) {
  const { path, stream, formatter } = await engine();
  const filename = `segmented_${hash}_syllable.txt`;
  const filePath = path.joinPath(path.OutputFile(), filename);
  const text = await stream.readFileContent(filePath);

  return text
    .split('\n')
    .map(formatter.toPositions)
    .filter((entry) => entry !== null);
}

/* ── Frontend entry ──────────────────────────────────────────────
   The server branch never holds an engine hash. It holds its own ids
   and the raw text:

     visitorHash / userId   sha256 hex, 32 chars   cookie/cgen.js:15
     formId                 crypto.randomUUID()    db/request.js:13
     submitId               crypto.randomUUID()    generator/responses.js:21

   Ours is  YYYYMMDD_HHMMSS_mmm , minted inside runMain().

   openFsmConnection() in gateway/generator/string.js is still a stub —
   it returns { connected: true, formId, submitId } and never reaches
   the engine. This is the seam it was left waiting for: validate the
   caller's id, run the pipeline, hand back BOTH ids so the submissions
   row can be reconciled against our output files.
   ─────────────────────────────────────────────────────────────── */

const HASH_SHAPE = {
  engine: /^\d{8}_\d{6}_\d{3}$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  session: /^[0-9a-f]{32}$/,
};

/** Which id shape is this? null means we refuse it. */
export function hashKind(hash) {
  if (typeof hash !== 'string') return null;
  for (const kind of Object.keys(HASH_SHAPE)) {
    if (HASH_SHAPE[kind].test(hash)) return kind;
  }
  return null;
}
