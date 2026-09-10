/* ═══════════════════════════════════════════════════════════════
   Module A – API Caller
   Reads:     a session hash from an external caller
   Processes: constructs the raw_pos filename from that hash
   Outputs:   delegates to Module B and returns the file text
   ═══════════════════════════════════════════════════════════════ */

import { OutputFile, joinPath } from '../Bridge/path.js';
import { readFileContent } from '../Bridge/streamline.js';

/**
 * Accept a hash, build the segmented_{hash}_raw_pos.txt path,
 * and ask Module B to read it.
 * @param {string} hash
 * @returns {Promise<string>} full file content
 */
export async function invokeWithHash(hash) {
  const filename = `segmented_${hash}_raw_pos.txt`;
  const filePath = joinPath(OutputFile(), filename);
  return await readFileContent(filePath);
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

/** Base consonant test — same rule the encoder uses (map-runtime.jsc). */
function isBase(ch) {
  const cp = ch.codePointAt(0);
  return (cp >= 0x1000 && cp <= 0x1021) || cp === 0x1025 || cp === 0x1027;
}

/** One cleaned line → { index, syllable }. Non-Burmese tokens are not ours. */
function toPositions(line) {
  /* Number/English tokens can carry a trailing space (classifyNumber /
     wrapEnglishBlocks), which turns the delimiter into 3 spaces — trim so
     the syllable after one is not mistaken for a non-Burmese token. */
  const tokens = line
    .split('  ')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const burmese = tokens.filter((t) => isBase(Array.from(t)[0] ?? ''));
  if (burmese.length === 0) return null;

  return {
    index: Array.from(burmese[0])[0],
    syllable: burmese.map((t) => String(Array.from(t).length - 1)),
  };
}

/**
 * Accept a hash, read segmented_{hash}_syllable.txt, and return the
 * syllable boundaries as positions — one entry per line that has
 * Burmese in it.
 * @param {string} hash
 * @returns {Promise<Array<{index: string, syllable: string[]}>>}
 */
export async function invokeSyllableWithHash(hash) {
  const filename = `segmented_${hash}_syllable.txt`;
  const filePath = joinPath(OutputFile(), filename);
  const text = await readFileContent(filePath);

  return text
    .split('\n')
    .map(toPositions)
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
