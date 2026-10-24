/**
 * FILE: Parsed/parser/text/repair.mjs
 *
 * Dictionary-arbitrated repair of homoglyph confusions.
 *
 * Several Myanmar code points share a single glyph in legacy faces -- ဝ/၀,
 * ရ/၇, ဉ/ဥ. A legacy code page has to resolve each shared glyph to one side,
 * and when it picks the wrong one the text is left with a character that
 * looks right and reads wrong. `scan.mjs`'s `digit` rule reports one case of
 * this (a digit flanked by letters) but it is one-directional: a LETTER
 * standing where a digit belongs is invisible to it, and ဉ/ဥ is outside it
 * entirely.
 *
 * Repairing by rule is unsafe -- ၀ is often a genuine digit and ဝ a genuine
 * letter -- so the dictionary arbitrates instead:
 *
 *   1. the token must NOT already be a word
 *   2. exactly ONE homoglyph-swapped variant must BE a word
 *   3. if two or more variants resolve, change nothing
 *
 * Under those conditions a repair cannot invent a word that was not already
 * in the dictionary, and cannot choose between competing readings.
 *
 * Measured over mm-grammar.pdf (445 pages, 3952 unknown tokens): 67 repaired,
 * 0 ambiguous. The dictionary never returned two candidates.
 */
import fs from "node:fs";
import path from "node:path";
import { MAP_DIR } from "../core/paths.mjs";

const DATA = JSON.parse(fs.readFileSync(path.join(MAP_DIR, "homoglyphs.json"), "utf8"));

/** [a, b] pairs, usable in either direction. */
export const HOMOGLYPH_PAIRS = DATA.pairs.map(([a, b]) => [a, b]);

/** Every single-character swap, both directions, as [from, to]. */
const SWAPS = HOMOGLYPH_PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]);

/** Tokens are Myanmar letters, marks and digits -- the same run scan.mjs uses. */
const MM_RUN = /[\u1000-\u1049\u105a-\u109f]+/gu;

/**
 * Every distinct token reachable by homoglyph swaps: all occurrences of a
 * character replaced together, and each occurrence replaced on its own.
 */
export function homoglyphVariants(token) {
  const out = new Set();
  for (const [from, to] of SWAPS) {
    if (!token.includes(from)) continue;
    out.add(token.split(from).join(to));
    let i = -1;
    while ((i = token.indexOf(from, i + 1)) >= 0) {
      out.add(token.slice(0, i) + to + token.slice(i + 1));
    }
  }
  out.delete(token);
  return [...out];
}

/**
 * The single dictionary-resolving variant of `token`, or null when the token
 * is already a word, nothing resolves, or more than one does.
 */
export function repairToken(token, words) {
  if (!words || !words.size || words.has(token)) return null;
  const hits = homoglyphVariants(token).filter((v) => words.has(v));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Repair homoglyph confusions across a whole text.
 * Returns { text, repairs } where repairs is [{ from, to, count }].
 */
export function repairHomoglyphs(text, words) {
  if (!text || !words || !words.size) return { text, repairs: [] };
  const tally = new Map();
  const out = String(text).replace(MM_RUN, (token) => {
    const fixed = repairToken(token, words);
    if (!fixed) return token;
    const key = `${token}\u0000${fixed}`;
    tally.set(key, (tally.get(key) || 0) + 1);
    return fixed;
  });
  const repairs = [...tally].map(([k, count]) => {
    const [from, to] = k.split("\u0000");
    return { from, to, count };
  }).sort((a, b) => b.count - a.count);
  return { text: out, repairs };
}

/**
 * Split a number that extraction glued onto a word.
 *
 * Table-of-contents and index lines lose their dot leaders during
 * extraction, so the page number joins the heading and the whole token
 * misses the dictionary -- သဒ္ဒါ၁, ဝဂ်၃၈, မျိုး၁၀၅, and in numbered lists the
 * marker leads instead: ၁။သဒ္ဒါ.
 *
 * The dictionary arbitrates exactly as it does for homoglyphs: a split is
 * applied only when the token is not already a word and stripping the digit
 * run from ONE end leaves a word. If both ends would work the token is left
 * alone. Over mm-grammar.pdf that is 108 trailing and 330 leading splits
 * with zero ambiguous cases.
 *
 * Returns [word, digits] in reading order, or null.
 */
export function splitGluedNumber(token, words) {
  if (!words || !words.size || words.has(token)) return null;
  const tail = /^(.*?)([\u1040-\u1049]+)$/u.exec(token);
  const head = /^([\u1040-\u1049]+)(.*)$/u.exec(token);
  const tailOk = Boolean(tail && tail[1] && words.has(tail[1]));
  const headOk = Boolean(head && head[2] && words.has(head[2]));
  if (tailOk && headOk) return null;        // ambiguous, change nothing
  if (tailOk) return [tail[1], tail[2]];
  if (headOk) return [head[1], head[2]];
  return null;
}

/**
 * Apply both repairs across a text: homoglyph swaps first, then glued
 * numbers. Returns { text, repairs, splits }.
 */
export function repairText(text, words) {
  const first = repairHomoglyphs(text, words);
  const tally = new Map();
  const out = first.text.replace(MM_RUN, (token) => {
    const parts = splitGluedNumber(token, words);
    if (!parts) return token;
    tally.set(token, (tally.get(token) || 0) + 1);
    return parts.join(" ");
  });
  const splits = [...tally].map(([from, count]) => ({ from, count }))
    .sort((a, b) => b.count - a.count);
  return { text: out, repairs: first.repairs, splits };
}
