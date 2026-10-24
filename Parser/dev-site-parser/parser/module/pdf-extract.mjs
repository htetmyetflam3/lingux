/**
 * Port of pdf_extract.py — low-level PDF parsing and text-layout extraction.
 *
 * Parity rules this file follows, and why:
 *
 *  - Objects are stored as zero-copy `Buffer` views (`subarray`), where Python
 *    `.strip()` copies each object body. The JS process therefore holds ~1x the
 *    file size where Python holds ~2x (raw + one stripped copy per object).
 *    That is a deliberate improvement, not a behaviour change: every offset the
 *    parser uses is relative to the slice, so trimming cannot move a match.
 *  - `objects` is a Map keyed `"num,gen"` with last-definition-wins, and every
 *    indirect reference elsewhere is resolved at generation 0 — matching Python,
 *    including where Python ignores the generation it just parsed.
 *  - Python's regexes run over BYTES; the JS ones run over `latin1`-decoded
 *    strings. latin1 is a byte-for-byte isomorphism, so match offsets are byte
 *    offsets and `\d`/`\s` stay ASCII-only.
 *  - Where Python's behaviour is a quirk (single `Tm` per BT block, `rfind` of
 *    `endstream`, negative slice indices in cmap format 4), the quirk is ported.
 *    Fixing it here would produce different text from the Python praser.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ValueError, pyTruthy, pyChr, pyInt, pyFloat, fromHexStrict, pyStripBytes } from "./pylib.mjs";
import { MAP_DIR } from "./paths.mjs";
import { MAX_PAGES, positiveLimit } from "./resource-limits.mjs";
import {
  Lexer, PdfName, PdfHexBytes, isNumeric, toNumber,
  asDocumentDecoding, FontResourceLoader, UnsetFontDecoder, pageFontDecoders,
} from "./pdf-fonts.mjs";

// ── decompression-bomb guard (pdf_extract.py:14-46) ─────────────────────
export const MAX_STREAM_MB = positiveLimit("PRASER_MAX_STREAM_MB", 128, 512);
export const MAX_PDF_OBJECTS = positiveLimit("PRASER_MAX_OBJECTS", 250_000, 1_000_000);

/** zlib.decompressobj() loop with a hard output cap.
 *  Python stops at the zlib EOF and IGNORES any trailing bytes, and returns
 *  b'' for empty input without ever calling decompress(). inflateSync is
 *  stricter on both counts, hence the explicit cases. */
export function zlibDecompressCapped(buf, limitMb = null) {
  const limit = (limitMb === null ? MAX_STREAM_MB : limitMb) * 1024 * 1024;
  if (buf.length === 0) return Buffer.alloc(0);
  try {
    const out = zlib.inflateSync(buf, { maxOutputLength: limit + (1 << 20) });
    if (out.length > limit) {
      throw new ValueError(`decompressed stream exceeds ${MAX_STREAM_MB} MB cap (decompression bomb?)`);
    }
    return out;
  } catch (e) {
    if (e instanceof ValueError) throw e;
    if (e && (e.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|buffer too large/i.test(String(e.message)))) {
      throw new ValueError(`decompressed stream exceeds ${MAX_STREAM_MB} MB cap (decompression bomb?)`);
    }
    // Trailing garbage after the zlib stream, or extra NULs: retry the way
    // decompressobj does — stop at the first Z_STREAM_END, drop the rest.
    const salvaged = inflateTolerant(buf, limit);
    if (salvaged !== null) return salvaged;
    throw e;
  }
}

function inflateTolerant(buf, limit) {
  const infl = new zlib.Inflate();
  const chunks = [];
  let size = 0;
  let failed = false;
  infl.on("error", () => { failed = true; });
  try {
    infl.write(buf);
    for (const c of infl.read(null)) {
      size += c.length;
      if (size > limit) {
        throw new ValueError(`decompressed stream exceeds ${MAX_STREAM_MB} MB cap (decompression bomb?)`);
      }
      chunks.push(c);
    }
  } catch (e) {
    if (e instanceof ValueError) throw e;
    // A read that throws after some output still mirrors a partial decompress.
    if (!chunks.length) return null;
  }
  if (failed && !chunks.length) return null;
  if (!chunks.length) return null;
  return Buffer.concat(chunks);
}

// ── object scan (parse_pdf_objects) ─────────────────────────────────────
// `re.finditer(rb'(\d+)\s+(\d+)\s+obj')` over the whole file, implemented as a
// direct byte scan: same language (\d = ASCII digits, \s = ASCII whitespace),
// without materialising a 1x-size latin1 copy of a possibly 100 MB buffer.
const B_ENDOBJ = Buffer.from("endobj");
const B_STREAM = Buffer.from("stream");
const B_ENDSTREAM = Buffer.from("endstream");
const B_FLAKE = Buffer.from("/FlateDecode");

const isDigit = (c) => c >= 0x30 && c <= 0x39;
// Python bytes-pattern \s == [ \t\n\r\f\v]
const isWsByte = (c) => c === 0x20 || (c >= 0x09 && c <= 0x0d);

export function parsePdfObjects(raw) {
  const objects = new Map();
  const n = raw.length;
  let i = 0;
  while (i < n) {
    if (!isDigit(raw[i])) { i += 1; continue; }
    let j = i;
    while (j < n && isDigit(raw[j])) j += 1;
    const numStr = raw.toString("latin1", i, j);
    let k = j;
    while (k < n && isWsByte(raw[k])) k += 1;
    if (k === j || k >= n || !isDigit(raw[k])) { i = j; continue; } // need \s+ then a digit
    let m = k;
    while (m < n && isDigit(raw[m])) m += 1;
    const genStr = raw.toString("latin1", k, m);
    let p = m;
    while (p < n && isWsByte(raw[p])) p += 1;
    if (p - m === 0) { i = j; continue; }
    if (raw.toString("latin1", p, p + 3) === "obj") {
      const start = p + 3;
      const end = raw.indexOf(B_ENDOBJ, start);
      if (end !== -1) {
        const key = `${pyInt(numStr)},${pyInt(genStr)}`;
        objects.set(key, pyStripBytes(raw.subarray(start, end))); // last definition wins
        if (objects.size > MAX_PDF_OBJECTS) {
          throw new ValueError(`PDF exceeds the ${MAX_PDF_OBJECTS} object cap`);
        }
      }
      i = start;
    } else {
      i = j;
    }
  }
  return objects;
}

/** get_stream(): first `stream`, LAST `endstream`, header-only FlateDecode test. */
export function getStream(objects, num, gen = 0) {
  const d = objects.get(`${num},${gen}`);
  if (d === undefined) return null;
  const i = d.indexOf(B_STREAM);
  if (i === -1) return null;
  let j = i + 6;
  if (j < d.length && d[j] === 0x0d) j += 1; // \r
  if (j < d.length && d[j] === 0x0a) j += 1; // \n
  const k = d.lastIndexOf(B_ENDSTREAM);
  if (k === -1) return null;
  const b = d.subarray(j, k);
  if (d.subarray(0, i).includes(B_FLAKE)) {
    try {
      return zlibDecompressCapped(b);
    } catch (e) {
      if (e instanceof ValueError) throw e; // bomb guard: refuse loudly, never silently
      return null;
    }
  }
  return b;
}

// ── metadata (present for fidelity; the pipeline never calls it) ────────
export function extractMetadata(objects) {
  const metadata = {};
  for (const [key, d] of objects) {
    const dStr = d.toString("latin1");
    if (/\/Type\s*\/Catalog/.test(dStr)) {
      const infoM = /\/Info\s+(\d+)\s+\d+\s+R/.exec(dStr);
      if (infoM) {
        const infoN = pyInt(infoM[1]);
        const infoBuf = objects.get(`${infoN},0`);
        const infoD = infoBuf === undefined ? "" : infoBuf.toString("latin1");
        const re = /\/([^\s/[\]<>()]+)\s*\(([^)]*)\)/g;
        let kv;
        while ((kv = re.exec(infoD)) !== null) metadata[kv[1]] = kv[2];
      }
      break;
    }
  }
  return metadata;
}

// ── embedded font streams ───────────────────────────────────────────────
const FONT_STREAM_RE = /\/FontFile(?:2|3)?\s+(\d+)\s+(\d+)\s+R/g;

export function findFontStreams(objects) {
  const refs = [];
  const seen = new Set();
  for (const d of objects.values()) {
    const dStr = d.toString("latin1");
    FONT_STREAM_RE.lastIndex = 0;
    let m;
    while ((m = FONT_STREAM_RE.exec(dStr)) !== null) {
      const ref = [pyInt(m[1]), pyInt(m[2])];
      const k = ref.join(",");
      if (!seen.has(k)) { seen.add(k); refs.push(ref); }
    }
  }
  return refs;
}

export const findFontFiles2 = findFontStreams; // backwards-compatible alias

// ── /ToUnicode CMaps ──────────────────────────────────────────────────────
/** _utf16be_to_str(): bytes.fromhex(hexstr).decode('utf-16-be', errors='replace') */
export function utf16beToStr(hexStr) {
  const raw = fromHexStrict(hexStr);
  if (raw.length % 2 !== 0) {
    // Python's replace handler turns the leftover byte into U+FFFD.
    return swapUtf16BE(raw.subarray(0, raw.length - 1)) + "\uFFFD";
  }
  return swapUtf16BE(raw);
}

function swapUtf16BE(raw) {
  const swapped = Buffer.allocUnsafe(raw.length);
  for (let i = 0; i + 1 < raw.length; i += 2) {
    swapped[i] = raw[i + 1];
    swapped[i + 1] = raw[i];
  }
  // Node's utf16le keeps unpaired surrogates; Python's errors='replace' swaps
  // them for U+FFFD, so match Python.
  const s = swapped.toString("utf16le");
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const lo = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (lo >= 0xdc00 && lo <= 0xdfff) { out += s[i] + s[i + 1]; i += 1; continue; }
      out += "\uFFFD";
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += "\uFFFD";
    } else out += s[i];
  }
  return out;
}

const BFCHAR_RE = /beginbfchar([\s\S]*?)endbfchar/g;
const BFCHAR_PAIR_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
const BFRANGE_RE = /beginbfrange([\s\S]*?)endbfrange/g;
const BFRANGE_SCALAR_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
const BFRANGE_ARRAY_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
const HEX_TOKEN_RE = /<([0-9A-Fa-f]+)>/g;

/** parse_tounicode_stream(): {code: str}. Within one stream later operators
 *  overwrite earlier ones (bfchar -> bfrange scalar -> bfrange array). */
export function parseToUnicodeStream(data) {
  let text;
  try {
    text = data.toString("latin1");
  } catch {
    return new Map();
  }
  const mapping = new Map();

  BFCHAR_RE.lastIndex = 0;
  let m;
  while ((m = BFCHAR_RE.exec(text)) !== null) {
    const body = m[1];
    BFCHAR_PAIR_RE.lastIndex = 0;
    let p;
    while ((p = BFCHAR_PAIR_RE.exec(body)) !== null) {
      mapping.set(Number(BigInt("0x" + p[1])), utf16beToStr(p[2]));
    }
  }

  BFRANGE_RE.lastIndex = 0;
  while ((m = BFRANGE_RE.exec(text)) !== null) {
    const body = m[1];
    BFRANGE_SCALAR_RE.lastIndex = 0;
    let p;
    while ((p = BFRANGE_SCALAR_RE.exec(body)) !== null) {
      const lo = Number(BigInt("0x" + p[1]));
      const hi = Number(BigInt("0x" + p[2]));
      const start = Number(BigInt("0x" + p[3]));
      for (let code = lo; code <= hi; code += 1) mapping.set(code, pyChr(start + (code - lo)));
    }
  }

  BFRANGE_RE.lastIndex = 0;
  while ((m = BFRANGE_RE.exec(text)) !== null) {
    const body = m[1];
    BFRANGE_ARRAY_RE.lastIndex = 0;
    let p;
    while ((p = BFRANGE_ARRAY_RE.exec(body)) !== null) {
      const lo = Number(BigInt("0x" + p[1]));
      const hi = Number(BigInt("0x" + p[2]));
      const items = [];
      HEX_TOKEN_RE.lastIndex = 0;
      let q;
      while ((q = HEX_TOKEN_RE.exec(p[3])) !== null) items.push(q[1]);
      let i = 0;
      for (let code = lo; code <= hi; code += 1, i += 1) {
        if (i < items.length) mapping.set(code, utf16beToStr(items[i]));
      }
    }
  }
  return mapping;
}

const TOUNICODE_RE = /\/ToUnicode\s+(\d+)\s+\d+\s+R/g;

/** find_tounicode_maps(): merge every CMap, first mapping wins per code;
 *  `seen` is keyed on the OBJECT NUMBER only (generation ignored, as in Python). */
export function findToUnicodeMaps(objects) {
  const codeToUni = new Map();
  const seen = new Set();
  for (const d of objects.values()) {
    const dStr = d.toString("latin1");
    if (!dStr.includes("/ToUnicode")) continue;
    TOUNICODE_RE.lastIndex = 0;
    let m;
    while ((m = TOUNICODE_RE.exec(dStr)) !== null) {
      const tn = pyInt(m[1]);
      if (seen.has(tn)) continue;
      seen.add(tn);
      const s = getStream(objects, tn);
      if (!pyTruthy(s)) continue;
      const mp = parseToUnicodeStream(s);
      if (mp.size === 0) continue;
      let spaces = 0;
      for (const v of mp.values()) if (v === " ") spaces += 1;
      if (spaces / mp.size > 0.9) {
        for (const [k, v] of [...mp]) if (v === " ") mp.delete(k); // blanked decoy
      }
      for (const [code, uni] of mp) if (!codeToUni.has(code)) codeToUni.set(code, uni);
    }
  }
  return codeToUni;
}

/** load_sidecar_map(): module/model/cipher-map.json, {int(k,16): v}. */
export function loadSidecarMap(p = null) {
  const file = p ?? path.join(MAP_DIR, "cipher-map.json");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return new Map();
  }
  try {
    const json = JSON.parse(text);
    const out = new Map();
    for (const [k, v] of Object.entries(json)) {
      let key = k.trim();
      if (/^0[xX]/.test(key)) key = key.slice(2);
      out.set(Number(BigInt("0x" + key.replace(/_/g, ""))), String(v));
    }
    return out;
  } catch {
    return new Map();
  }
}

// ── page tree ─────────────────────────────────────────────────────────────
const MEDIABOX_RE = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/;
const PARENT_RE = /\/Parent\s+(\d+)\s+(\d+)\s+R/;

export function getPageMediabox(objects, pageNum, pageGen) {
  let d = objects.get(`${pageNum},${pageGen}`);
  if (d === undefined) d = Buffer.alloc(0);
  let text = d.toString("latin1");
  for (let hop = 0; hop < 8; hop += 1) {
    const m = MEDIABOX_RE.exec(text);
    if (m) {
      // groups are x0 y0 x1 y1, exactly as the MediaBox array reads
      const [x0, y0, x1, y1] = [m[1], m[2], m[3], m[4]].map(pyFloat);
      return [Math.abs(x1 - x0), Math.abs(y1 - y0)];
    }
    const pm = PARENT_RE.exec(text);
    if (!pm) break;
    const parent = objects.get(`${pyInt(pm[1])},${pyInt(pm[2])}`);
    text = parent === undefined ? "" : parent.toString("latin1");
  }
  return [612.0, 792.0];
}

const RES_REF_RE = /\/Resources\s+(\d+)\s+\d+\s+R/;
const XOBJECT_REF_RE = /\/XObject\s+(\d+)\s+\d+\s+R/;
const SUBTYPE_IMAGE_RE = /\/Subtype\s*\/Image/;
const ANY_REF_RE = /(\d+)\s+\d+\s+R/g;

export function pageHasImages(objects, pageNum, pageGen) {
  const get = (refNum) => {
    const raw = objects.get(`${pyInt(refNum)},0`);
    return raw === undefined ? "" : raw.toString("latin1");
  };
  const pageBuf = objects.get(`${pageNum},${pageGen}`);
  const d = pageBuf === undefined ? "" : pageBuf.toString("latin1");
  let res = d;
  const m = RES_REF_RE.exec(d);
  if (m) res = get(m[1]);
  if (SUBTYPE_IMAGE_RE.test(res)) return true;
  const mx = XOBJECT_REF_RE.exec(res);
  const xo = mx ? get(mx[1]) : res;
  if (SUBTYPE_IMAGE_RE.test(xo)) return true;
  ANY_REF_RE.lastIndex = 0;
  let rm;
  while ((rm = ANY_REF_RE.exec(xo)) !== null) {
    if (SUBTYPE_IMAGE_RE.test(get(rm[1]))) return true;
  }
  return false;
}

export function collectPages(
  objects,
  pageNum,
  gen = 0,
  state = { visiting: new Set(), seenPages: new Set(), count: 0 },
) {
  const key = `${pageNum},${gen}`;
  if (state.visiting.has(key)) throw new ValueError("Cycle found in PDF page tree");
  const buf = objects.get(key);
  const dStr = buf === undefined ? "" : buf.toString("latin1");
  if (/\/Type\s*\/Page(?!s)/.test(dStr)) {
    if (state.seenPages.has(key)) return [];
    state.seenPages.add(key);
    state.count += 1;
    if (state.count > MAX_PAGES) {
      throw new ValueError(`PDF exceeds the ${MAX_PAGES} page cap`);
    }
    return [[pageNum, gen]];
  }
  if (/\/Type\s*\/Pages/.test(dStr)) {
    state.visiting.add(key);
    try {
      const pages = [];
      const km = /\/Kids\s*\[([\s\S]*?)\]/.exec(dStr);
      if (km) {
        const kidsText = km[1];
        ANY_REF_RE.lastIndex = 0;
        const refs = [];
        let r;
        while ((r = ANY_REF_RE.exec(kidsText)) !== null) refs.push(r[1]);
        for (const ref of refs) {
          // Generation is forced to zero, as in the original parser.
          pages.push(...collectPages(objects, pyInt(ref), 0, state));
        }
      }
      return pages;
    } finally {
      state.visiting.delete(key);
    }
  }
  return [];
}

export function findRootPages(objects) {
  for (const [key, d] of objects) {
    const dStr = d.toString("latin1");
    if (/\/Type\s*\/Catalog/.test(dStr)) {
      const pm = /\/Pages\s+(\d+)\s+\d+\s+R/.exec(dStr);
      if (pm) return pyInt(pm[1]);
    }
  }
  return null;
}

// ── code -> unicode ───────────────────────────────────────────────────────
// IDENTITY / CmapIdentityMap / LegacyAyarMap / mapCode() now live in
// pdf-fonts.mjs (Python: pdf_fonts.py), the module that also owns the real
// per-font-resource FontDecoder architecture these feed into. Re-exported
// here so existing callers (pipeline.mjs) keep working unchanged.
export { IDENTITY, CmapIdentityMap, LegacyAyarMap, mapCode } from "./pdf-fonts.mjs";

// Stable PDF character-code map for the Arlarwade TrueType subsets (an old
// Ayar-compatible font family). Subset glyph IDs are renumbered per font, so
// this intentionally maps the original content-stream character CODE, not a
// glyph id — the one thing that stays stable across every subset instance.
//
// NOT the same table as legacy-code-pages.mjs's AYAR_LEGACY_CODE_PAGE, and
// not superseded by it: the two serve different steps of the same decoder.
// AYAR_LEGACY_CODE_PAGE (and WININNWA_LEGACY_CODE_PAGE) are keyboard-layout
// code pages keyed by the RAW BYTE a legacy font's own (decoy) /ToUnicode
// reveals — FontDecoder._legacyLookup's bridge. This table is the document-
// level FALLBACK (DocumentDecoding("legacy", ...).map) used when a font of
// this specific family has no usable /ToUnicode of its own to bridge
// through. Matches Python pdf_extract.py's ARLARWADE_AYAR_MAP verbatim.
export const ARLARWADE_AYAR_MAP = new Map([
  [33, "ြ"], [34, "ပ"], [35, "ည"], [36, "်"], [37, "ေ"], [38, "ထ"],
  [39, "ာ"], [40, "င"], [41, "စ"], [42, "ု"], [43, "သ"], [44, "မ"],
  [45, "္မ"], [46, "တ"], [47, "န"], [48, "န"], [49, "ိ"], [50, "ံ"],
  [51, "ရ"], [52, "း"], [53, "၀"], [54, "ြ"], [55, "က"], [56, "ီ"],
  [57, "ဌ"], [58, "အ"], [59, "ဖ"], [60, "ွ"], [61, "ဲ"], [62, "့"],
  [63, "ဥ"], [64, "ဒ"], [65, "ယ"], [66, "ှ"], [67, "ခ"], [68, "၂"],
  [69, "၀"], [70, "၁"], [71, "၃"], [72, "—"], [73, "၊"], [74, " "],
  [75, "လ"], [76, "ူ"], [77, "။"], [78, "က"], [79, "ျ"], [80, "ါ"],
  [81, "္ဒ"], [82, "ါ"], [83, "၅"], [84, "ဇ"], [85, "ံ"], [86, "့"],
  [87, "ြ"], [88, "ု"], [89, "၂"], [90, "၍"], [91, "ဝ"], [92, ""],
  [93, "ဉ"], [94, "ဏ"], [95, "ဆ"], [96, "၉"], [97, "၈"], [98, "၄"],
  [99, "ဘ"], [100, "၆"], [101, "ဤ"], [102, "ြ"], [103, "ခ"], [104, "ဂ"],
  [105, ""], [106, "ဗ"], [107, "ရ"], [108, "("], [109, ")"], [110, "ဃ"],
  [111, "၌"], [112, "ဈ"], [113, "ဍ"], [114, "ဎ"], [115, "၊"], [116, "ဝ"],
  [117, "စ"], [118, "ဗ"], [119, "ဝ"], [120, "ၺ"], [121, "ပ"],
]);

// Port of pdf_extract.py's `mm_score.MARKS` import — needed by
// fixDigitConsonantConfusion below. Dependent marks: signs that cannot stand
// without a base in front of them.
const DEP_MARKS = new Set(Array.from(
  "\u103b\u103c\u103d\u103e\u1031\u102d\u102e\u102f"
  + "\u1030\u1032\u102c\u102b\u1036\u103a\u1037\u1038",
).map((c) => c.codePointAt(0)));

/**
 * fix_digit_consonant_confusion(): restore the consonant U+101D (wa) where a legacy
 * face wrote the digit U+1040 (zero) -- same glyph, and legacy code pages routinely
 * resolve it to the digit. Structural disambiguation only:
 *
 *   1. a digit wearing a dependent MARK;
 *   2. a digit with a Myanmar letter or mark on BOTH sides (inside a word, and a
 *      number is not) -- the common case, since the neighbour in front is usually
 *      a mark rather than a base.
 *
 * The same glyph runs the other way too: U+101B (ra) and U+1047 (digit seven) are
 * one shape, so a U+101B INSIDE a run of digits is the digit -- repeated to a fixed
 * point so a run resolves from either end (a run opening with ra+digit needs the
 * rightmost to become the digit before the leftmost can see one).
 */
export function fixDigitConsonantConfusion(text) {
  const letterOrMark = (ch) => {
    if (!ch) return false;
    const cp = ch.codePointAt(0);
    return (cp >= 0x1000 && cp <= 0x1021) || cp === 0x1025 || cp === 0x1027
      || cp === 0x1039 || DEP_MARKS.has(cp);
  };
  const isDigit = (ch) => {
    if (!ch) return false;
    const cp = ch.codePointAt(0);
    return cp >= 0x1040 && cp <= 0x1049;
  };
  const isBase = (ch) => {
    if (!ch) return false;
    const cp = ch.codePointAt(0);
    return cp >= 0x1000 && cp <= 0x1021;
  };

  let out = Array.from(text);
  const n = out.length;
  for (let i = 0; i < n; i += 1) {
    const after = i + 1 < n ? out[i + 1] : "";
    const before = i > 0 ? out[i - 1] : "";
    if (out[i] === "\u1040") {
      // U+1040 -> U+101D : the digit is wearing a mark, or sits inside a word
      if (DEP_MARKS.has((after || "").codePointAt(0)) || (letterOrMark(before) && letterOrMark(after))) {
        out[i] = "\u101d";
      } else if (!isDigit(before) && !letterOrMark(before) && isBase(after)) {
        // ...or it OPENS a word: a number does not run into a consonant
        out[i] = "\u101d";
      }
    }
  }
  text = out.join("");

  // U+101B and U+1047 are the same glyph, and the test is simply this: the shape
  // is U+101B unless a digit sits next to it. A following Myanmar letter or mark
  // means U+101B, while a following digit -- or another U+101B -- keeps it numeric.
  // Repeated to a fixed point so a run resolves from either end.
  for (let pass = 0; pass < 3; pass += 1) {
    const chars = Array.from(text);
    let changed = false;
    for (let i = 0; i < chars.length; i += 1) {
      if (chars[i] !== "\u101b") continue;
      const before = i > 0 ? chars[i - 1] : "";
      const after = i + 1 < chars.length ? chars[i + 1] : "";
      if ((isDigit(before) || isDigit(after))
          && (!letterOrMark(after) || isDigit(after) || after === "\u101b")) {
        chars[i] = "\u1047";
        changed = true;
      }
    }
    text = chars.join("");
    if (!changed) break;
  }
  return text;
}

/**
 * collapse_overprint(): collapse a piece that is one short unit drawn twice (or
 * three times) -- the faux-bold producer repeats glyphs INSIDE one text-showing
 * operation, so a single piece arrives as e.g. a doubled letter or doubled mark
 * pair. Deliberately narrow: the WHOLE piece must be the unit repeated, the unit
 * at most 3 characters and the piece at most 9 -- a real repeated word never
 * arrives as its own isolated fragment.
 */
export function collapseOverprint(text) {
  const chars = Array.from(text);
  const n = chars.length;
  if (n < 2 || n > 9) return text;
  for (const size of [1, 2, 3]) {
    if (n % size !== 0 || Math.floor(n / size) < 2) continue;
    const unit = chars.slice(0, size).join("");
    if (unit.repeat(n / size) === text) return unit;
  }
  return text;
}

/**
 * legacy_ayar_to_unicode(): put Ayar's visual/legacy order into normal Myanmar
 * code-point order. Intentionally small and conservative -- mirrors the
 * established Ayar -> Myanmar3 conversion rules: move preposed vowels after the
 * base, move kinzi clusters into their Unicode order, and remove the legacy ZWSP.
 */
export function legacyAyarToUnicode(text) {
  text = text.replace(/\u200b/g, "");

  // ONE left-to-right pass for the preposed vowels. Two passes cannot work: the
  // first would place a cluster correctly, and the second would then see that
  // same vowel sitting in front of the next base and move it again. Matching
  // once and continuing past the replacement is what keeps it put. The vowel
  // clears the WHOLE cluster (base + kinzi + stacked consonants), never landing
  // inside it.
  text = text.replace(
    /([ေြ]+)([က-အ၀၇၈])(င်္)?((?:္[က-အ])*)/g,
    (_m, vowel, base, kinzi, stacked) => (kinzi || "") + base + (stacked || "") + vowel,
  );

  // A kinzi that is NOT followed by a consonant cannot belong to one on its
  // right, so it belongs to the cluster on its LEFT and moves in front of it.
  // When a consonant DOES follow, the kinzi is already where it belongs and is
  // left alone. Must run AFTER the preposed vowel is placed, and the group it
  // jumps must include that vowel, or a later split destroys the cluster.
  text = text.replace(
    /([က-အ][ါ-ှ]*)(င်္)(?![က-အ])/g,
    "$2$1",
  );
  text = text.replace(/(ေ)([ျွဲှ္ြ]+)/g, "$2$1");
  text = text.replace(/([က-အ])([က-အ])(င်္)/g, "$1$3$2");
  // Ayar writes U+1026 (ဦ) as the visually-equivalent U+1025 U+102E sequence in a
  // number of older subsets; normalize it back.
  text = text.replace(/ဦး/g, "ဦး");

  // Reorder-by-priority is NOT done here -- that belongs to exactly one place,
  // normalize.reorderMarks, which reads the single shared priority table. What
  // stays is what only this function can do: the legacy font's visual order,
  // plus the digit/consonant repair a following mark needs a base to attach to.
  return fixDigitConsonantConfusion(text);
}


// ── content-stream walking (pdf_extract.py's iter_content_operations) ──────
// A real (if small) PDF tokenizer, not a per-block regex: text-showing
// operators have to be seen in sequence with the Tf operators around them,
// because the active font persists across BT...ET blocks and one page
// routinely mixes a Latin resource with a Myanmar one.

// An inline image's binary data is not PDF syntax, so the tokenizer must jump
// over it instead of trying to read it. `EI` ends the image and is always
// preceded by whitespace.
const INLINE_IMAGE_END_RE = /[\x00\x09-\x0d\x20]EI(?=[\x00\x09-\x0d\x20[\]<>/%(]|$)/g;

function skipInlineImage(data, pos) {
  INLINE_IMAGE_END_RE.lastIndex = pos;
  const m = INLINE_IMAGE_END_RE.exec(data);
  return m ? INLINE_IMAGE_END_RE.lastIndex : data.length;
}

/** Yield [operator, operands] of a content stream, in document order.
 * `data` is a byte-string (see pdf-fonts.mjs's module docstring). */
function* iterContentOperations(data) {
  const lex = new Lexer(data);
  let operands = [];
  const containers = [];
  for (;;) {
    const tok = lex.nextToken();
    if (tok === null) break;
    const [kind, value] = tok;
    if (kind === "aopen") { containers.push({ type: "a", mark: operands.length }); continue; }
    if (kind === "dopen") { containers.push({ type: "d", mark: operands.length }); continue; }
    if (kind === "aclose" || kind === "dclose") {
      if (!containers.length) continue;
      const { type, mark } = containers.pop();
      const items = operands.splice(mark);
      if (type === "a") {
        operands.push(items);
      } else {
        const d = new Map();
        for (let i = 0; i < items.length - 1; i += 2) {
          if (items[i] instanceof PdfName) d.set(String(items[i]), items[i + 1]);
        }
        operands.push(d);
      }
      continue;
    }
    if (kind === "kw") {
      if (containers.length) { operands.push(value); continue; } // e.g. "n g R" inside an array
      const op = String(value);
      if (op === "ID") { // inline image data follows
        lex.pos = skipInlineImage(data, lex.pos);
        operands = [];
        continue;
      }
      yield [op, operands];
      operands = [];
      continue;
    }
    operands.push(value);
    if (!containers.length && operands.length > 64) {
      // Malformed stream guard: an operator never takes more than a handful
      // of operands. Only trimmed at the top level — a TJ array legitimately
      // holds hundreds of strings and kerning numbers.
      operands.splice(0, operands.length - 16);
    }
  }
}

/** Return the (byte-string | PdfHexBytes) strings a text-showing operator
 * draws, in order. */
function shownStrings(op, operands) {
  if (!operands.length) return [];
  if (op === "Tj" || op === "'" || op === '"') {
    const last = operands[operands.length - 1];
    return (typeof last === "string" || last instanceof PdfHexBytes) ? [last] : [];
  }
  if (op === "TJ") {
    const last = operands[operands.length - 1];
    if (Array.isArray(last)) return last.filter((item) => typeof item === "string" || item instanceof PdfHexBytes);
  }
  return [];
}

/** One FontResourceLoader per document, cached on the strategy — decoders
 * are cached by object number, which only identifies a font within one
 * document. */
function documentLoader(doc, objects) {
  let { loader } = doc;
  if (loader === null || loader.objects !== objects) {
    loader = new FontResourceLoader(objects, getStream, parseTtfCmap, parseToUnicodeStream);
    doc.loader = loader;
    doc.resetFontCache();
  }
  return loader;
}

const CONTENTS_REF_RE = /\/Contents\s+(\d+)\s+\d+\s+R/;
const CONTENTS_ARR_RE = /\/Contents\s*\[([\s\S]*?)\]/;

/** extract_page_lines(): (lines, pageW, pageH) — lines top-to-bottom,
 *  [x, y, size, text] with y measured from the page BOTTOM (PDF user space).
 *
 * `decoding` is the document-level fallback strategy (a DocumentDecoding, a
 * bare Map, or IDENTITY — all accepted and wrapped). It is NOT applied to
 * the page as a whole: each /Font resource of the page gets its own decoder
 * and the Tf operator decides which one every shown string goes through.
 *
 * `detectColumns` mirrors pdf_extract.py's multi-column splitter parameter
 * but is not implemented here: it is gated OFF by default in Python and no
 * caller in this codebase (Python or JS) ever turns it on, so it is dead
 * code for every real document. Passing `true` here is a no-op (falls
 * through to the single-column path), instead of silently duplicating ~60
 * lines of unexercised logic. */
export function extractPageLines(objects, pageNum, pageGen, decoding) {
  const doc = asDocumentDecoding(decoding);
  const loader = documentLoader(doc, objects);
  const decoders = pageFontDecoders(loader, pageNum, pageGen, doc);
  const unsetFont = new UnsetFontDecoder("", { doc });

  const pdBuf = objects.get(`${pageNum},${pageGen}`);
  const pdStr = pdBuf === undefined ? "" : pdBuf.toString("latin1");
  let streams = [];
  const cm = CONTENTS_REF_RE.exec(pdStr);
  if (cm) {
    streams = [pyInt(cm[1])];
  } else {
    const ca = CONTENTS_ARR_RE.exec(pdStr);
    if (ca) {
      ANY_REF_RE.lastIndex = 0;
      streams = [];
      let x;
      while ((x = ANY_REF_RE.exec(ca[1])) !== null) streams.push(pyInt(x[1]));
    }
  }

  const pieces = []; // [y, x, size, text]

  // The active text font survives BT/ET boundaries and, because a page's
  // content streams are one stream logically, the stream boundary too — a
  // title drawn in a BT...ET block with no Tf at all inherits the resource
  // selected several blocks earlier, which a per-block regex cannot see.
  let active = null;

  for (const sn of streams) {
    const s = getStream(objects, sn);
    if (!pyTruthy(s)) continue;
    const content = s.toString("latin1");

    let inBlock = false;
    let blockTexts = [];
    let blockXy = null;
    let blockSize = null;
    let textXy = [0.0, 0.0];
    let leading = 0.0;

    for (const [op, operands] of iterContentOperations(content)) {
      if (op === "Tf") {
        if (operands.length >= 2 && operands[operands.length - 2] instanceof PdfName) {
          active = decoders.get(String(operands[operands.length - 2])) ?? null;
        }
        if (inBlock && operands.length && isNumeric(operands[operands.length - 1])) {
          blockSize = toNumber(operands[operands.length - 1]); // last Tf inside the block wins
        }
        continue;
      }

      if (op === "BT") {
        if (!inBlock) {
          inBlock = true;
          blockTexts = [];
          blockXy = null;
          blockSize = null;
          // BT resets the text matrix to the identity, i.e. the origin.
          textXy = [0.0, 0.0];
          leading = 0.0;
        }
        continue;
      }

      if (!inBlock) continue;

      if (op === "Tm") {
        if (operands.length >= 6 && operands.slice(-6).every(isNumeric)) {
          textXy = [toNumber(operands[operands.length - 2]), toNumber(operands[operands.length - 1])];
          if (blockXy === null) blockXy = textXy;
        }
        continue;
      }

      // Td/TD/T* position text just as legitimately as Tm, and some
      // producers never emit Tm at all.
      if (op === "Td" || op === "TD") {
        if (operands.length >= 2 && operands.slice(-2).every(isNumeric)) {
          const dx = toNumber(operands[operands.length - 2]);
          const dy = toNumber(operands[operands.length - 1]);
          // Both translate the LINE matrix, so they are relative to the
          // start of the current line, not the current point.
          textXy = [textXy[0] + dx, textXy[1] + dy];
          if (op === "TD") leading = -dy;
          if (blockXy === null) blockXy = textXy;
        }
        continue;
      }

      if (op === "TL") {
        if (operands.length && isNumeric(operands[operands.length - 1])) {
          leading = toNumber(operands[operands.length - 1]);
        }
        continue;
      }

      if (op === "T*") {
        textXy = [textXy[0], textXy[1] - leading];
        if (blockXy === null) blockXy = textXy;
        continue;
      }

      if (op === "ET") {
        inBlock = false;
        if (blockTexts.length && blockXy !== null) {
          // NOT rewritten here. A legacy fix needs the characters on either
          // side, and pieces are split across blocks constantly — the fix
          // runs once the LINE is assembled, in flush() below.
          let text = blockTexts.join("");
          if (doc.legacyTextFix) text = collapseOverprint(text);
          pieces.push([blockXy[1], blockXy[0], blockSize === null ? 12.0 : blockSize, text]);
        }
        blockTexts = [];
        continue;
      }

      if (op === "Tj" || op === "TJ" || op === "'" || op === '"') {
        const decoder = active !== null ? active : unsetFont;
        for (const shown of shownStrings(op, operands)) {
          // UnsetFontDecoder distinguishes hex- from literal-origin strings
          // (2-byte vs 1-byte reading) and wants the PdfHexBytes wrapper
          // itself; every other decoder treats both origins identically —
          // decodeCode()/cmap.iterCodes() just want the raw byte-string.
          const arg = decoder instanceof UnsetFontDecoder || !(shown instanceof PdfHexBytes)
            ? shown : shown.s;
          blockTexts.push(decoder.decode(arg));
        }
      }
    }
  }

  // PDF producers often draw the same glyph run several times with tiny sub-point
  // offsets to create a faux-bold/outline effect. Those are visual shadows, not
  // repeated sentences -- and the overprint is not always a copy of the WHOLE run:
  // some producers redraw only a FRAGMENT of it, and a fragment is not equal to
  // anything, so it would otherwise survive and get spliced back into the middle of
  // the line by the x-sort. CONTAINMENT, not just equality, catches that: a piece
  // whose text is contained in (or equal to) one already kept at the same spot
  // (+/-1pt) is dropped; if the earlier one is the fragment, the fuller run replaces
  // it so the longer text survives either way it arrived.
  const uniquePieces = [];
  for (const piece of pieces) {
    const [y, x, , text] = piece;
    let drop = false;
    for (let k = 0; k < uniquePieces.length; k += 1) {
      const [oldY, oldX, , oldText] = uniquePieces[k];
      if (Math.abs(x - oldX) > 1.0 || Math.abs(y - oldY) > 1.0) continue;
      if (text === oldText || oldText.includes(text)) {
        drop = true; // same ink, or a fragment of it
        break;
      }
      if (text.includes(oldText)) {
        // the shadow arrived first: keep the longer, fuller run
        uniquePieces[k] = piece;
        drop = true;
        break;
      }
    }
    if (!drop) uniquePieces.push(piece);
  }
  pieces.length = 0;
  pieces.push(...uniquePieces);

  const [pageW, pageH] = getPageMediabox(objects, pageNum, pageGen);
  if (!pieces.length) return [[], pageW, pageH];

  pieces.sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]));

  const lines = [];
  let currentY = pieces[0][0];
  let currentLine = [];
  const flush = () => {
    // Sort by x ONLY, relying on the sort being stable (Array#sort is a stable sort
    // in Node): two pieces drawn at the same x keep content-stream order, which is
    // the order the producer wrote them in. A legacy face draws a tall consonant's
    // medial ha (U+103E) as its own block placed at the x of the NEXT block, and a
    // tie-break on the TEXT instead would sort it after other marks and strand it
    // at the end of the line.
    const ordered = [...currentLine].sort((p, q) => p[0] - q[0]);
    let maxSize = -Infinity;
    for (const [, s] of ordered) if (s > maxSize) maxSize = s;
    let joined = ordered.map(([, , t]) => t).join("");
    if (doc.legacyTextFix) joined = legacyAyarToUnicode(joined);
    lines.push([ordered[0][0], currentY, maxSize, joined]);
  };

  for (const [y, x, size, text] of pieces) {
    if (Math.abs(y - currentY) > 3) {
      flush();
      currentLine = [];
      currentY = y;
    }
    currentLine.push([x, size, text]);
  }
  if (currentLine.length) flush();

  return [lines, pageW, pageH];
}

const isAsciiDigitOrDot = (ch) => (ch >= "0" && ch <= "9") || ch === ".";

/** extract_page_text_layout(): the joined text only. */
export function extractPageTextLayout(objects, pageNum, pageGen, codeToUni) {
  const [lines] = extractPageLines(objects, pageNum, pageGen, codeToUni);
  return lines.map((l) => l[3]).join("\n");
}

// ── embedded font / TTF ────────────────────────────────────────────────────
const MYA_LO = 0x1000;
const MYA_HI = 0x109f;

function hasMyanmarGlyphs(cmap) {
  for (const cp of cmap.keys()) if (cp >= MYA_LO && cp <= MYA_HI) return true;
  return false;
}

export function pickEmbeddedFont(objects, refs, log = () => {}) {
  let fallback = null;
  for (const ref of refs) {
    const ttf = getStream(objects, ref[0], ref[1]);
    if (!pyTruthy(ttf)) continue;
    const cmap = parseTtfCmap(ttf);
    if (hasMyanmarGlyphs(cmap)) {
      log(`[+] Chosen embedded font obj ${ref[0]} (contains Myanmar glyphs)`);
      return [ref, ttf, cmap];
    }
    if (fallback === null) fallback = [ref, ttf, cmap];
  }
  if (fallback !== null) {
    log(`[i] No Myanmar-glyph font found; using first font stream obj ${fallback[0][0]}`);
    return fallback;
  }
  return [null, null, new Map()];
}

/** parse_ttf_cmap(): Map<unicodeCodePoint, glyphId>.
 *  Format 4 reproduces CPython's slice arithmetic exactly, including the way a
 *  negative idRangeOffset index reads from the END of the subtable (and how a
 *  -1/-2 index raises struct.error instead). */
export function parseTtfCmap(data) {
  if (!data || data.length < 12) return new Map();
  const numTables = data.readUInt16BE(4);
  const tbls = new Map();
  let off = 12;
  for (let t = 0; t < numTables; t += 1) {
    if (off + 16 > data.length) break;
    const tag = data.toString("latin1", off, off + 4);
    tbls.set(tag, data.readUInt32BE(off + 8));
    off += 16;
  }
  if (!tbls.has("cmap")) return new Map();
  const cmapOff = tbls.get("cmap");
  if (cmapOff + 4 > data.length) return new Map();
  const cmap = data.subarray(cmapOff); // Python: data[cmap_off:] (offset wraps if negative)
  const numSub = cmap.readUInt16BE(2);
  const mappings = new Map();
  off = 4;
  for (let s = 0; s < numSub; s += 1) {
    if (off + 8 > cmap.length) break;
    const plat = cmap.readUInt16BE(off);
    const enc = cmap.readUInt16BE(off + 2);
    const subOff = cmap.readUInt32BE(off + 4);
    off += 8;
    if (subOff + 2 > cmap.length) continue;
    const sub = cmap.subarray(subOff);
    if (sub.length < 2) continue;
    const fmt = sub.readUInt16BE(0);
    if (fmt === 4) {
      if (sub.length < 14) continue;
      const segCount = sub.readUInt16BE(6) >> 1; // // 2
      if (sub.length < 14 + segCount * 8) continue;
      const ends = [];
      for (let i = 0; i < segCount; i += 1) ends.push(sub.readUInt16BE(14 + i * 2));
      const so = 14 + segCount * 2 + 2;
      const starts = [];
      for (let i = 0; i < segCount; i += 1) starts.push(sub.readUInt16BE(so + i * 2));
      const doff = so + segCount * 2;
      const deltas = [];
      for (let i = 0; i < segCount; i += 1) deltas.push(sub.readInt16BE(doff + i * 2)); // '>h' SIGNED
      const ro = doff + segCount * 2;
      const ranges = [];
      for (let i = 0; i < segCount; i += 1) ranges.push(sub.readUInt16BE(ro + i * 2));
      for (let j = 0; j < segCount; j += 1) {
        if (starts[j] === 0xffff) continue;
        for (let c = starts[j]; c <= ends[j]; c += 1) {
          let gid;
          if (ranges[j] === 0) {
            gid = (c + deltas[j]) & 0xffff;
          } else {
            const idx = ((ranges[j] / 2) | 0) + (c - starts[j]) + j - segCount;
            const addr = ro + idx * 2;
            if (addr + 2 > sub.length) continue; // Python checks only the upper bound
            gid = readU16PythonSlice(sub, addr);
            if (gid) gid = (gid + deltas[j]) & 0xffff;
          }
          if (gid) mappings.set(c, gid);
        }
      }
    } else if (fmt === 6) {
      if (sub.length < 10) continue;
      const firstCode = sub.readUInt16BE(6);
      const entryCount = sub.readUInt16BE(8);
      for (let j = 0; j < entryCount; j += 1) {
        if (10 + j * 2 + 2 > sub.length) break;
        const gid = sub.readUInt16BE(10 + j * 2);
        if (gid) mappings.set(firstCode + j, gid);
      }
    } else if (fmt === 12) {
      if (sub.length < 16) continue;
      const numGroups = sub.readUInt32BE(12);
      let go = 16;
      for (let g = 0; g < numGroups; g += 1) {
        if (go + 12 > sub.length) break;
        const sc = sub.readUInt32BE(go);
        const ec = sub.readUInt32BE(go + 4);
        const sg = sub.readUInt32BE(go + 8);
        go += 12;
        for (let c = sc; c <= ec; c += 1) mappings.set(c, sg + (c - sc)); // unmasked, as in Python
      }
    }
    void plat; void enc; // plat/enc are read but unused by the Python version
  }
  return mappings;
}

/** struct.unpack('>H', buf[a:a+2]) with Python slice semantics: negative start
 *  wraps from the end, the stop index does NOT follow it, and a slice that is
 *  not exactly 2 bytes raises. */
function readU16PythonSlice(buf, a) {
  let start = a < 0 ? buf.length + a : a;
  let stop = a + 2;
  if (stop < 0) stop = buf.length + stop;
  start = Math.min(Math.max(start, 0), buf.length);
  stop = Math.min(Math.max(stop, 0), buf.length);
  if (stop - start !== 2) throw new ValueError("unpack requires a buffer of 2 bytes");
  return buf.readUInt16BE(start);
}

export { hasMyanmarGlyphs };
