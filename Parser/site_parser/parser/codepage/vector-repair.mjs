/**
 * FILE: Parsed/parser/codepage/vector-repair.mjs
 *
 * RECOVER THE GLYPHS THE CMAP CANNOT NAME, BY SHAPE.
 *
 * THE DEFECT. Some embedded subsets name every glyph they draw except a
 * handful, and for those the /ToUnicode carries whitespace as filler. The
 * decoder then does the honest thing and emits nothing at all -- so the
 * reader sees
 *
 *     အကီးအကဲ        when the page says  အကြီးအကဲ
 *
 * The medial ra ြ (U+103C) is simply absent. It is not mis-decoded, it is
 * dropped. On the 4414-page book this is 0.9% of glyphs and it lands on
 * exactly the codes 239 / 241 / 247 -- which is why whole words come out
 * wrong while most of the page reads fine.
 *
 * THE FIX. Those glyphs are not missing from the FILE. The subset still
 * carries their outlines -- the shapes were always there, only their names
 * were missing. So read the outline, ask the 339-face witness corpus what
 * byte that shape sits at, and decode the answer. Nothing is rendered, no
 * canvas, no JPEG, no OCR: this is the file's own vector data.
 *
 * WHY IT IS SAFE. The repair is consulted ONLY where the decoder produced
 * the empty string. It cannot displace a glyph that already decoded, so the
 * 99.1% that works is untouched by construction.
 *
 * Two things it must get right, both learned the hard way:
 *
 *   DISTANCE LEADS THE VOTE. Ranking candidates by vote count instead of
 *   shape distance is what destroyed these medials in the first place (see
 *   the comment at the ranking in outline-vote.mjs).
 *
 *   THE ANSWER IS IN PRE-BASE ORDER. WinInnwa writes a medial BEFORE the
 *   consonant it belongs to, so a voted ြ arrives as အြကီး and has to be
 *   moved behind the က to read အကြီး.
 */

import fs from "node:fs";
import path from "node:path";

import { TtfFont, glyphContours } from "../read/glyf.mjs";
import { glyphSignature } from "../shape/contour.mjs";
import { parseTtfCmap } from "../core/ttf-cmap.mjs";
import { pickEmbeddedFont, hasMyanmarGlyphs } from "../read/pdf-extract.mjs";
import { crowdVote, loadWitnesses } from "./outline-vote.mjs";
import { WININNWA_LEGACY_CODE_PAGE } from "./registry.mjs";

const WITNESS_FILE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..", "map", "vector", "font-witnesses.json",
);

/** U+103C ြ, U+103B ျ, U+103D ွ, U+103E ှ -- the four medials. */
const MEDIALS = "\u103C\u103B\u103D\u103E";
/** U+1039 virama, the conjunct marker. */
const VIRAMA = "\u1039";
/** A consonant, U+1000..U+1021. */
const CONSONANT = /[\u1000-\u1021]/;

let witnessCache = null;

/**
 * The witness corpus, read once per process.
 *
 * 339 faces is ~18 MB of JSON; loading it per page would dominate the run.
 */
export function witnessesFor(file = WITNESS_FILE) {
  if (!witnessCache) {
    witnessCache = loadWitnesses(file, { readFile: (p) => fs.readFileSync(p) });
  }
  return witnessCache;
}

/**
 * Move a voted medial behind the consonant it belongs to.
 *
 * WinInnwa lays a medial out BEFORE its consonant, so the raw voted text
 * reads အြကီး where the reader wants အကြီး. Two spellings turn up in the
 * corpus and both have to be handled:
 *
 *   medial + consonant            -> consonant + medial
 *   medial + virama + consonant   -> consonant + medial
 *
 * The second form is the one the book actually uses. The virama is dropped
 * because the medial, not a conjunct, was what the shape meant.
 *
 * A virama that was NOT preceded by a medial is left strictly alone --
 * ကမ္ဘာ keeps its ္, since that one is a real conjunct.
 */
export function reorderPreBase(text) {
  if (!text) return text;
  const chars = [...text];
  let out = "";
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (MEDIALS.includes(c)) {
      if (chars[i + 1] === VIRAMA && CONSONANT.test(chars[i + 2] || "")) {
        out += chars[i + 2] + c;
        i += 3;
        continue;
      }
      if (CONSONANT.test(chars[i + 1] || "")) {
        out += chars[i + 1] + c;
        i += 2;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

/** The outline of one glyph id, normalised the way the witnesses are. */
function signatureFor(font, gid, samples) {
  let raw;
  try {
    raw = glyphContours(font, gid);
  } catch {
    return null;
  }
  if (!raw || !raw.length) return null;
  const upm = font.unitsPerEm || 1000;
  return glyphSignature(
    raw.map((c) => c.map((p) => [p.x / upm, p.y / upm])),
    { samples },
  );
}

/**
 * Ask the corpus what text a glyph id carries.
 *
 * @param fonts     [{ TtfFont, name }] the embedded programs to look in
 * @param gid       the glyph id the content stream drew
 * @param witnesses the loaded corpus
 * @returns {{ text: string, byte: number|null, distance: number, agreement: number, font: string }|null}
 */
export function voteGlyph(fonts, gid, witnesses, { claimLimit = 0.06 } = {}) {
  const samples = witnesses[0]?.byByte.values().next().value?.points?.[0]?.length ?? 8;
  let winner = null;
  for (const entry of fonts) {
    const observed = signatureFor(entry.font, gid, samples);
    if (!observed) continue;
    const result = crowdVote(observed, witnesses, { claimLimit });
    if (!result || result.byte === null) continue;
    const text = WININNWA_LEGACY_CODE_PAGE.get(result.byte);
    if (!text) continue;
    if (!winner || result.best < winner.distance) {
      winner = {
        text: reorderPreBase(text),
        raw: text,
        byte: result.byte,
        distance: result.best,
        agreement: result.agreement ?? 0,
        font: entry.name,
      };
    }
  }
  return winner;
}

/**
 * Build gid -> text for the glyphs the decoder could not name.
 *
 * `blind` is that set, gathered by a probe pass over the first pages. Only
 * these ids are voted on, so the cost is a handful of shapes against the
 * corpus rather than the whole font.
 *
 * @param {{objects: Map, getStream: Function}} source
 * @param {Iterable<number>} blind  glyph ids that decoded to nothing
 * @param {{ log?: Function, witnesses?: Array }} options
 */
export function buildVectorRepair(source, blind, { log = () => {}, witnesses = null } = {}) {
  const ids = [...new Set([...blind].map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return null;

  const corpus = witnesses || witnessesFor();
  if (!corpus.length) {
    log("[!] vector repair: no witness corpus loaded");
    return null;
  }

  /* WHICH FONTS MAY VOTE. Only the family the document actually draws
     Burmese with.

     A merged PDF carries several unrelated families and their glyph ids
     are NOT comparable -- in this book gid 241 is the medial ra in the
     eleven upm=900 Myanmar3 subsets, and the letter ဆ in the two upm=2048
     subsets. Asking every font and keeping the closest match therefore
     picked the wrong family, because the wrong answer happened to sit at
     0.0293 and the right one at 0.0476. Distance is only meaningful
     between shapes drawn by the same hand.

     So: take the family of the primary embedded font -- the one the
     pipeline already trusts, chosen by pickEmbeddedFont -- and let only
     subsets sharing its unitsPerEm and carrying Myanmar glyphs vote. */
  /* The family's unitsPerEm, taken from the primary embedded font -- the
     one pickEmbeddedFont already chose for the document. Callers that
     have it to hand may pass it as `source.primary`. */
  let primary = source.primary;
  if (primary === undefined || primary === null) {
    try {
      const [, bytes] = pickEmbeddedFont(source.objects, source.fontRefs || []);
      if (bytes && bytes.length) primary = new TtfFont(bytes).unitsPerEm;
    } catch { /* fall through: no primary means no family filter */ }
  }
  const sameFamily = (upm, hasMyanmar) =>
    upm !== undefined && hasMyanmar
    && (primary === null || primary === undefined || upm === primary);

  const fonts = [];
  for (const ref of source.fontRefs || []) {
    let bytes;
    try {
      bytes = source.getStream(source.objects, ref[0], ref[1]);
    } catch {
      continue;
    }
    if (!bytes || !bytes.length) continue;
    try {
      const font = new TtfFont(bytes);
      if (!sameFamily(font.unitsPerEm, hasMyanmarGlyphs(parseTtfCmap(bytes)))) continue;
      fonts.push({ font, name: `${ref[0]},${ref[1]}` });
    } catch {
      /* Not a TTF we can read (a CFF, say); skip it. */
    }
  }
  if (!fonts.length) {
    log("[!] vector repair: no embedded font program could be read");
    return null;
  }

  const byGid = new Map();
  const stats = { asked: ids.length, recovered: 0, fonts: fonts.length };
  for (const gid of ids) {
    const hit = voteGlyph(fonts, gid, corpus);
    if (!hit) {
      log(`    vector repair: gid ${gid} -- no witness claimed it`);
      continue;
    }
    byGid.set(gid, hit.text);
    stats.recovered += 1;
    log(`    vector repair: gid ${gid} -> ${JSON.stringify(hit.text)}`
      + ` (byte ${hit.byte}, d=${hit.distance.toFixed(4)}, `
      + `agreement ${(hit.agreement * 100).toFixed(0)}%)`);
  }

  if (!byGid.size) return null;
  return { byGid, stats, details: byGid };
}
