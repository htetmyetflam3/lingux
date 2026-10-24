/**
 * Port of cleanup.py — imposter cleanup + canonical mark reorder — PLUS the two
 * normalizations the map runtime defines (normalize.mjs is the single home for all of
 * them so the pipeline never has to know where a step came from).
 *
 * Modes the praser offers (owner's call, 2026-09-17):
 *   "normalize"    the map's normalize(): NFC -> strip glue + $ # ^ { } sqrt ->
 *                  mark-reorder -> imposter fix -> wrap English blocks in {braces}.
 *                  THE DEFAULT: what the owner's pipeline wants downstream.
 *   "mynormalize"  the owner's corpus-building order — NFC -> DELETE English blocks ->
 *                  imposter fix -> mark-reorder. No brace wrapping, and no glue strip:
 *                  pure Burmese text with the latin noise removed.
 *   "none"         nothing on top of the cleanup gate — the Python-parity path.
 *   "mapper"       not run inside this PDF post-processor: mapperNormalize is the
 *                  Engine/parts/loaded.js stage. The Engine pipeline now accepts it
 *                  as a `mapperNormalize` parameter (default mapperNormalize, or
 *                  MyNormalize/"mynormalize" for corpus jobs).
 *
 * Where it is applied: prase.mjs, once per page text and once per layout line, AFTER
 * the cleanup gate. The API's batch helpers (processPdfBytes / collectStreamResults)
 * keep {base, clean} exactly as the Python's, because the service exposes cleanup as a
 * per-request toggle and has no normalize stage at all.
 *
 * The mark table these two use is `mm_score.MARK_ORDER`, the grammar engine's table
 * verbatim — space is 17, newline 18, and both `cleanup.py`'s `_PRIORITY` and this
 * module's `PRIORITY` are that SAME table now (2026-09-29: "One priority table, the
 * engine's" — cleanup.py used to carry a second, shorter copy that stopped at 16; it
 * doesn't any more, so there is no longer a gap between the `cleanup` gate and the map
 * runtime's own reorder here).
 *
 * `CONSONANTS` is the engine's `index()` / `mm_score.is_index()` test: U+1000..U+1021
 * plus U+1025 and U+1027, and NOTHING else — not digits, not independent vowels beyond
 * those two, not punctuation. `cleanup.reorder_marks` used to run on a wider "Myanmar
 * consonant" set that let a digit or an independent vowel act as a mark base; that drift
 * was closed 2026-09-29, and `is_index` is the only definition of "base" left. A digit
 * or independent vowel outside {U+1025, U+1027} is NOT a base any more, so marks after
 * one pass through untouched instead of being gathered and sorted onto it.
 *
 * SEAM: this is the step your JS side may already own as MyNormalize/normalize.
 * The behaviour implemented here is exactly what cleanup.py does, and the
 * imposter table, priority table, consonant set and glue set are read from
 * model/normalize.json (generated straight off cleanup.py / mm_score.py — see the
 * inline script this file's history was regenerated with) — so the fallback can
 * never drift from the Python it is replacing.
 *
 * To route this to your normalizer instead, set PRASER_NORMALIZE_MODULE to a
 * module exporting { cleanupText } (or a default with .cleanupText / .normalize);
 * pipeline.mjs only ever calls cleanupText()/orderText().
 *
 * Three details that are easy to lose in a translation:
 *  - `cleanImposters` is a LONGEST-MATCH walk over a trie (mirroring cleanup.py's
 *    `_build_imposter_trie`/`clean_imposters`), not a per-codepoint table: several
 *    imposters are multi-character sequences that render identically to the correct
 *    form (`သြေ်` -> `ဪ`, `၄င်း` -> `၎င်း`, ...) and a flat per-character map cannot
 *    express "longest wins". A replacement's own output is never re-scanned — the walk
 *    resumes after what it just emitted, exactly like the trie/str.translate parity
 *    the Python documents.
 *  - `reorder_marks` DROPS a repeated mark rather than leaving it in place: the
 *    `seen` priority set skips the second \u102D but still advances past it.
 *  - `order_text`/`cleanup_text` both run `normalizeGlue` (NFC + strip the glue set)
 *    FIRST. A zero-width joiner or the dotted-circle placeholder sitting between a
 *    base and its marks would otherwise split a cluster in two and hide the very run
 *    that needs reordering.
 */
import fs from "node:fs";
import path from "node:path";
import { MAP_DIR } from "./paths.mjs";

const DATA = JSON.parse(fs.readFileSync(path.join(MAP_DIR, "normalize.json"), "utf8"));

// priority: char -> int (mm_score.MARK_ORDER, space=17 / newline=18 included), and the
// consonant (is_index) / glue / mark-membership sets.
const PRIORITY = new Map(Object.entries(DATA.priority).map(([k, v]) => [k.codePointAt(0), v]));
const CONSONANTS = new Set(DATA.consonants.map((c) => c.codePointAt(0)));
const CLEANUP_GLUE = new Set((DATA.glue || []).map((c) => c.codePointAt(0)));
export const MARKS = new Set((DATA.marks || []).map((c) => c.codePointAt(0)));

// Imposter trie, built once at import — exactly like cleanup.py's: one node per
// character, the replacement hanging off the last node of each key. Matching is
// LONGEST-first, so a multi-character imposter wins over a shorter one that starts
// the same way, which a flat per-character table cannot express.
const REPLACEMENT = Symbol("replacement");

function buildImposterTrie(reps) {
  const trie = new Map();
  for (const [from, to] of reps) {
    let node = trie;
    for (const ch of from) {
      let next = node.get(ch);
      if (!next) { next = new Map(); node.set(ch, next); }
      node = next;
    }
    node.set(REPLACEMENT, to);
  }
  return trie;
}

const IMPOSTER_TRIE = buildImposterTrie(DATA.reps);

/** clean_imposters(): replace any lingering Zawgyi/lookalike imposter sequence with
 *  the correct Unicode, longest match wins. A replacement is never re-scanned: the
 *  walk resumes after what it just emitted, so one imposter cannot cascade into
 *  another. */
export function cleanImposters(t) {
  if (!t) return t;
  const chars = Array.from(t);
  const n = chars.length;
  const out = [];
  let i = 0;
  while (i < n) {
    let node = IMPOSTER_TRIE;
    let j = i;
    let lastMatch = -1;
    let replacement = null;
    while (j < n && node.has(chars[j])) {
      node = node.get(chars[j]);
      j += 1;
      if (node.has(REPLACEMENT)) {
        lastMatch = j;
        replacement = node.get(REPLACEMENT);
      }
    }
    if (replacement !== null) {
      out.push(replacement);
      i = lastMatch;
    } else {
      out.push(chars[i]);
      i += 1;
    }
  }
  return out.join("");
}

/** normalize_text(): NFC, then drop every glue codepoint.
 *
 *  cleanup.py's first step. Zero-width joiners, bidi controls, a dotted circle
 *  placeholder or a stray no-break space sit BETWEEN a base and its marks and would
 *  otherwise split a cluster in two, so they go before anything else looks at the
 *  text. Named `normalizeGlue` here (not `normalizeText`) to avoid colliding with
 *  this module's unrelated map-runtime `normalizeText` below. */
export function normalizeGlue(t) {
  if (!t || typeof t !== "string") return "";
  const parts = [];
  for (const ch of t.normalize("NFC")) {
    if (!CLEANUP_GLUE.has(ch.codePointAt(0))) parts.push(ch);
  }
  return parts.join("");
}

/** reorder_marks(): reorder Myanmar dependent marks into canonical Unicode order.
 *
 *  One loop, no leading-prefix phase — the engine has none either, and needs none: a
 *  leading space, digit or anything else that is not a base (per `is_index`) falls
 *  through the else branch below untouched. */
export function reorderMarks(t) {
  if (!t || typeof t !== "string") return "";

  const chars = Array.from(t); // code points, like list(str) in Python
  const out = [];
  let i = 0;
  const n = chars.length;

  while (i < n) {
    const ch = chars[i];
    if (CONSONANTS.has(ch.codePointAt(0))) {
      out.push(ch);
      i += 1;

      const marks = [];
      const seen = new Set();
      while (i < n) {
        const nxt = chars[i];
        if (CONSONANTS.has(nxt.codePointAt(0))) break;
        const p = PRIORITY.get(nxt.codePointAt(0));
        if (p === undefined) break;
        if (!seen.has(p)) {
          seen.add(p);
          marks.push(nxt);
        }
        i += 1;
      }

      if (marks.length) {
        marks.sort((a, b) => PRIORITY.get(a.codePointAt(0)) - PRIORITY.get(b.codePointAt(0)));
        out.push(...marks);
      }
    } else {
      out.push(ch);
      i += 1;
    }
  }

  return out.join("");
}

/** order_text(): normalize + reorder — the part that runs on EVERY page, always,
 *  whatever the category (Zawgyi after Rabbit, Unicode, Unknown). Ordering marks by
 *  priority is not an opinion about a document, it is the one canonical sequence, so
 *  it is not behind the cleanup toggle and not tied to a category. Imposter
 *  replacement is NOT here — that is `cleanupText`'s step, the Unicode branch's alone. */
export function orderText(t) {
  return reorderMarks(normalizeGlue(t));
}

/** cleanup_text(): the toggleable step — imposter cleanup on top of normalize + reorder.
 *  Reorder runs again after the replacement, because an imposter can expand into real
 *  marks (U+1088 -> U+103E U+102F) that then have to take their place in the run. */
export function cleanupText(t) {
  return reorderMarks(cleanImposters(normalizeGlue(t)));
}

let external = null;

/** Optional swap-in for the repo's own normalizer (see header). */
export async function initNormalize() {
  const mod = process.env.PRASER_NORMALIZE_MODULE;
  if (!mod) return { external: false };
  const imported = await import(mod);
  const fn = imported.cleanupText ?? imported.normalize ?? imported.default?.cleanupText ?? imported.default?.normalize;
  if (typeof fn !== "function") throw new TypeError(`${mod} exports no cleanupText/normalize function`);
  external = fn;
  return { external: true };
}

export const isExternalNormalize = () => external !== null;

// ═══════════════════════════════════════════════════════════════════════════
//  The map runtime's normalizations (normalize / mynormalize)
//
//  Ported from R_Site/Build/mapbuilder/mymap/_encode.js + the owner's scratch, with
//  the tables generated out of sourceMap.js by .bin/gen-praser-normalize.mjs (see
//  model/normalize-map.json). debugLogPass()/logen.js is engine-side debug logging and
//  is deliberately NOT pulled in — the praser keeps its own `log` callback discipline.
// ═══════════════════════════════════════════════════════════════════════════

const MAPDATA = JSON.parse(fs.readFileSync(path.join(MAP_DIR, "normalize-map.json"), "utf8"));

const PRIORITY2 = MAPDATA.priority;                                    // char -> weight
const GLUE = new Set(MAPDATA.glue);
const PUNCTUATION = new Set(MAPDATA.punctuation);
const ENGLISH_DIGITS = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
const BURMESE_DIGITS = new Set(["\u1040", "\u1041", "\u1042", "\u1043", "\u1044",
  "\u1045", "\u1046", "\u1047", "\u1048", "\u1049"]);

// Flattened exactly like the map's cleanImposters(): Object.values order first, then a
// stable sort by descending `from` length — so ties keep the family order, which is how
// '\u1009\u102C\u100B\u103A' (a no-op rep) can still win over a shorter one.
const IMPOSTER_REPS = [];
for (const entry of MAPDATA.imposter) {
  for (const imp of entry.imposters) IMPOSTER_REPS.push({ from: imp, to: entry.correct });
}
IMPOSTER_REPS.sort((a, b) => b.from.length - a.from.length);

/** The map's cleanImposters(): sequential split/join passes, so an earlier replacement
 *  CAN be re-scanned by a later one (unlike str.translate). */
export function engineCleanImposters(t) {
  let tmp = t;
  for (const r of IMPOSTER_REPS) tmp = tmp.split(r.from).join(r.to);
  return tmp;
}

/** The map's `index()`: is this char a cluster base? Narrower than cleanup.py's
 *  consonant set — 0x1000-0x1021 plus 0x1025 and 0x1027, nothing else. */
const isClusterBase = (ch) => {
  const cp = ch.codePointAt(0);
  return (cp >= 0x1000 && cp <= 0x1021) || cp === 0x1025 || cp === 0x1027;
};

/** The map's reorderString(): leading non-base chars pass through, then each base
 *  gathers the marks that follow — where space and newline ARE marks (17, 18) and the
 *  gathering CONTINUES past them, so a cluster can reach across a space. A repeated
 *  priority is dropped, same idea as reorderMarks. */
export function engineReorderString(t) {
  if (!t || typeof t !== "string") return "";
  const chars = Array.from(t);
  let out = "";
  let i = 0;
  while (i < chars.length && !isClusterBase(chars[i])) { out += chars[i]; i += 1; }
  while (i < chars.length) {
    const ch = chars[i];
    if (isClusterBase(ch)) {
      out += ch;
      i += 1;
      const marks = [];
      const seen = new Set();
      while (i < chars.length) {
        const next = chars[i];
        if (isClusterBase(next)) break;
        const p = PRIORITY2[next];
        if (p === undefined) break;
        if (!seen.has(p)) { seen.add(p); marks.push(next); }
        i += 1;
      }
      if (marks.length) {
        marks.sort((a, b) => PRIORITY2[a] - PRIORITY2[b]);
        out += marks.join("");
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

const isLowerOrUpperAZ = (ch) => {
  if (typeof ch !== "string" || ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90);   // a-z, A-Z
};

const BLOCK_PUNCT = new Set([",", ".", ":", ";", "/", "(", ")", "-", "!", "?", " "]);

function blockCharType(ch) {
  if (isLowerOrUpperAZ(ch)) return "E";
  if (ENGLISH_DIGITS.has(ch)) return "L";
  if (BURMESE_DIGITS.has(ch)) return "B";
  if (BLOCK_PUNCT.has(ch)) return "P";
  return null;
}

/** The shared scan of wrapEnglishBlocks / deleteEnglishBlocks: find a run of one char
 *  type (E, L or B) that may be interrupted by block punctuation, collapse its internal
 *  spaces, and split off the trailing spaces that belong BETWEEN tokens. Returns null
 *  when this position starts no block. */
function englishBlock(str, i) {
  const startType = blockCharType(str[i]);
  if (startType !== "E" && startType !== "L" && startType !== "B") return null;
  let j = i;
  while (j < str.length) {
    const t = blockCharType(str[j]);
    if (t === null) break;
    if (t === "P" || t === startType) { j += 1; continue; }
    break;
  }
  const block = str.slice(i, j).replace(/ +/g, " ");
  const trimmed = block.replace(/ +$/, "");
  return { end: j, trimmed, tail: block.slice(trimmed.length) };
}

/** wrapEnglishBlocks(): latin/digit/Burmese-digit runs become {tokens} for the
 *  downstream tagger. The trailing spaces stay OUTSIDE the braces — the comment in
 *  _encode.js says putting them inside made "hello " a token whose space became a
 *  3-space delimiter and a leading-space syllable. */
export function wrapEnglishBlocks(str) {
  let out = "";
  let i = 0;
  while (i < str.length) {
    const blk = englishBlock(str, i);
    if (blk) { out += `{${blk.trimmed}}${blk.tail}`; i = blk.end; continue; }
    out += str[i];
    i += 1;
  }
  return out;
}

/** deleteEnglishBlocks(): the same scan, but the block is dropped instead of wrapped —
 *  the owner's "clean other noise from pure Burmese text". The inter-token whitespace
 *  that wrap kept outside the braces is kept here too, so only the block itself goes:
 *  "…ပွဲ " keeps its trailing space and "Chapter 701: " leaves the space that preceded
 *  it, i.e. "text Chapter" -> "text" with the old separator still there (one space for
 *  wrap's one space, so no run of spaces grows). If you want the leftover collapsed,
 *  that is a deliberate extra step — say so and it goes here. */
export function deleteEnglishBlocks(str) {
  let out = "";
  let i = 0;
  while (i < str.length) {
    const blk = englishBlock(str, i);
    if (blk) { out += blk.tail; i = blk.end; continue; }
    out += str[i];
    i += 1;
  }
  return out;
}

/** normalize(): the map's function, same step order, same option names. */
export function normalizeText(text, opts = {}) {
  if (!text || typeof text !== "string") return "";
  const { stripPunctuation = false, cleanMode = "gentle" } = opts;
  let result = text.normalize("NFC");
  const stripPunct = stripPunctuation || cleanMode === "aggressive";
  let cleaned = "";
  for (const ch of result) {
    if (GLUE.has(ch)) continue;
    // \u221A is the token delimiter (bridge.js join / tagger.js split): stripped on the
    // way in so input text can never collide with it.
    if (ch === "$" || ch === "#" || ch === "^" || ch === "{" || ch === "}" || ch === "\u221A") continue;
    if (stripPunct && PUNCTUATION.has(ch)) continue;
    cleaned += ch;
  }
  result = engineReorderString(cleaned);
  result = engineCleanImposters(result);
  return wrapEnglishBlocks(result);
}

/** myNormalize(): the owner's corpus order — delete the english blocks, fix imposters,
 *  reorder. No glue/delimiter strip and no wrapping, and the imposter pass runs BEFORE
 *  the reorder (normalize() does it after). */
export function myNormalize(str) {
  if (!str || typeof str !== "string") return "";
  let result = str.normalize("NFC");
  result = deleteEnglishBlocks(result);
  result = engineCleanImposters(result);
  result = engineReorderString(result);
  return result;
}

// Stable public names for callers that select a normalizer by function rather
// than by the CLI string. `normalize` is the default; `mynormalize` is the
// corpus-building variant.
export const normalize = normalizeText;
export const mynormalize = myNormalize;

export const NORMALIZE_MODES = ["normalize", "mynormalize", "none"];

/** Pick the post-conversion normalizer. `null` means "the cleanup gate alone", which is
 *  what the Python does — the parity path. */
export function pickNormalize(mode = "normalize") {
  if (mode === null || mode === undefined || mode === "" || mode === "none" || mode === false) return null;
  const m = String(mode).toLowerCase().replace(/[\s_-]/g, "");
  if (m === "normalize") return normalizeText;
  if (m === "mynormalize") return myNormalize;
  throw new Error(`Unknown normalize mode: ${JSON.stringify(mode)} (use ${NORMALIZE_MODES.map((x) => `"${x}"`).join(" | ")})`);
}
