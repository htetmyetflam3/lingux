/**
 * Port of pdf_fonts.py — font-specific PDF text decoding, ONE decoder per
 * `/Font` resource.
 *
 * Why this module exists (mirrors the Python docstring): a PDF page selects
 * fonts by resource name (`/F1`, `/F2`, ...) with `Tf`, and every shown
 * string must be decoded with the rules of the font active at that moment.
 * Two resources on the same page routinely point at the SAME embedded font
 * program and declare COMPLETELY DIFFERENT encodings — a Myanmar
 * `/Identity-H` resource and a Latin `/WinAnsiEncoding` resource, both cut
 * from one embedded Zawgyi-One subset. Decoding the whole page with a single
 * document-wide "glyph id -> Unicode" map silently reinterprets Latin
 * character codes as glyph ids ("God of Slaughter" -> "dod of plaughter").
 * So decoding is resolved per font resource; `pdf-extract.mjs` tracks the
 * `Tf` operator while walking the content stream.
 *
 * Byte-string convention: raw PDF string/content-stream bytes are carried as
 * plain JS strings where each UTF-16 code UNIT is one byte value 0-255 (the
 * same latin1 isomorphism pdf-extract.mjs already uses for its regexes).
 * `Buffer`s (from `getStream`) are converted to this convention with
 * `.toString("latin1")` at the boundary. A value decoded from a HEX string
 * literal (`<...>`) is distinguished from a literal `(...)` string — needed
 * only for text shown before any `Tf` selects a resource — by boxing it in
 * `PdfHexBytes`; a literal string stays a plain JS string.
 *
 * This module deliberately knows nothing about pdf-extract.mjs; the stream
 * primitives it needs are injected through `FontResourceLoader`, keeping the
 * import graph acyclic (pdf-fonts.mjs <- pdf-extract.mjs), exactly like
 * Python's `pdf_fonts` <- `pdf_extract`.
 */
import { pyChr } from "./pylib.mjs";
import { BASE_ENCODINGS, GLYPH_NAME_TO_UNICODE } from "./pdf-encodings.mjs";
import { LEGACY_CODE_PAGES } from "./legacy-code-pages.mjs";

export { LEGACY_CODE_PAGES };

// ═══════════════════════════════════════════════════════════════════════════
//  1. Minimal PDF object syntax (shared by object bodies and content streams)
// ═══════════════════════════════════════════════════════════════════════════

/** A PDF `/Name` (kept distinct from a plain string operand). */
export class PdfName {
  constructor(v) { this.v = v; }
  toString() { return this.v; }
  valueOf() { return this.v; }
}

/** A bare PDF keyword / content-stream operator (`Tj`, `R`, `true`). */
export class PdfKeyword {
  constructor(v) { this.v = v; }
  toString() { return this.v; }
  valueOf() { return this.v; }
}

/** A number token that had a decimal point (Python `float`, as opposed to a
 * plain JS number for an `int` token). JS numbers cannot tell `2` from
 * `2.0` apart the way `isinstance(x, int)` does, and `parse_object`'s
 * early-return heuristic (a lone INT could still become the start of an
 * `N G R` reference, so it is not returned yet; a lone float never can be)
 * depends on that distinction. `extends Number` keeps arithmetic/coercion
 * working transparently (`f + 1`, `Number(f)`, `String(f)` all just work). */
export class PdfFloat extends Number {}

/** True for a value that behaves like Python's `isinstance(v, (int, float))`
 * — a plain int-literal number or a PdfFloat. (Booleans are deliberately
 * excluded here, unlike Python's `int` overlap with `bool`, because every
 * call site that needs Python's numeric-or-bool test spells it out itself —
 * see `isIntLike` below for that one.) */
export const isNumeric = (v) => typeof v === "number" || v instanceof PdfFloat;
export const toNumber = (v) => (typeof v === "number" ? v : v.valueOf());

/** A string written as `<48656C6C6F>` — boxes a byte-string (see module
 *  docstring) only so text shown before any `Tf` can still be read as
 *  two-byte CIDs, exactly like Python's `HexString(bytes)`. */
export class PdfHexBytes {
  constructor(s) { this.s = s; }
}

/** An indirect reference `n g R`. */
export class PdfRef {
  constructor(num, gen = 0) {
    this.num = Math.trunc(num);
    this.gen = Math.trunc(gen);
  }
  key() { return `${this.num},${this.gen}`; }
  toString() { return `${this.num} ${this.gen} R`; }
}

// Python bytes-pattern classes, translated to explicit byte ranges instead of
// `\s` — JS `\s` (no `u` flag) also matches U+00A0 and other separators that
// exist as single chars in our latin1 byte-string, which Python's *bytes*
// `\s` does not. `\d` has no such gap (ASCII-only either way).
const WS = "\\x00\\x09-\\x0d\\x20";
const TOKEN_RE = new RegExp(
  `[${WS}]*(?:`
  + "(?<comment>%[^\\r\\n]*)"
  + `|(?<name>/[^${WS}()<>\\[\\]{}/%]*)`
  + "|(?<num>[+-]*(?:\\d+\\.\\d*|\\.\\d+|\\d+))"
  + "|(?<dopen><<)"
  + "|(?<dclose>>>)"
  + "|(?<hex><[^>]*>)"
  + "|(?<aopen>\\[)"
  + "|(?<aclose>\\])"
  + "|(?<lit>\\()"
  + "|(?<popen>\\{)"
  + "|(?<pclose>\\})"
  + "|(?<kw>[A-Za-z'\"*][A-Za-z0-9'\"*]*)"
  + `|(?<other>[^${WS}])`
  + ")",
  "y",
);

const LIT_SPECIAL_RE = /[()\\\r]/g;

const ESCAPES = new Map([
  [0x6e, "\n"], [0x72, "\r"], [0x74, "\t"], [0x62, "\b"], [0x66, "\f"],
  [0x28, "("], [0x29, ")"], [0x5c, "\\"],
]);

/** scan_literal_string(): scan a `(...)` string body starting at `i` (AFTER
 * the `(`). Returns [rawByteString, endIndex]. Full PDF escape set, nested
 * balanced parens, bare EOL -> line feed. `data` is a byte-string. */
export function scanLiteralString(data, i) {
  let depth = 1;
  let out = "";
  const n = data.length;
  while (i < n) {
    LIT_SPECIAL_RE.lastIndex = i;
    const m = LIT_SPECIAL_RE.exec(data);
    if (m === null) {
      out += data.slice(i);
      return [out, n];
    }
    out += data.slice(i, m.index);
    const c = m[0];
    i = m.index + 1;
    if (c === "(") {
      depth += 1;
      out += "(";
    } else if (c === ")") {
      depth -= 1;
      if (depth === 0) return [out, i];
      out += ")";
    } else if (c === "\r") {
      if (i < n && data[i] === "\n") i += 1;
      out += "\n";
    } else { // backslash
      if (i >= n) break;
      const b = data.charCodeAt(i);
      i += 1;
      if (ESCAPES.has(b)) {
        out += ESCAPES.get(b);
      } else if (b >= 0x30 && b <= 0x37) { // octal \ddd
        let val = b - 0x30;
        for (let k = 0; k < 2; k += 1) {
          if (i < n && data.charCodeAt(i) >= 0x30 && data.charCodeAt(i) <= 0x37) {
            val = val * 8 + (data.charCodeAt(i) - 0x30);
            i += 1;
          } else break;
        }
        out += String.fromCharCode(val & 0xff);
      } else if (b === 0x0a) { // line continuation
        /* pass */
      } else if (b === 0x0d) {
        if (i < n && data[i] === "\n") i += 1;
      } else {
        out += String.fromCharCode(b); // \x -> x
      }
    }
  }
  return [out, n];
}

/** `<48656C 6C6F>` -> byte-string "Hello" (odd trailing digit padded with 0). */
function hexToByteString(text) {
  let digits = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if ((c >= "0" && c <= "9") || (c >= "A" && c <= "F") || (c >= "a" && c <= "f")) digits += c;
  }
  if (digits.length % 2) digits += "0";
  let out = "";
  for (let i = 0; i < digits.length; i += 2) {
    const v = Number.parseInt(digits.slice(i, i + 2), 16);
    if (Number.isNaN(v)) return ""; // pragma: no cover — matches ValueError -> b""
    out += String.fromCharCode(v);
  }
  return out;
}

const NAME_ESC_RE = /#([0-9A-Fa-f]{2})/g;

/** `Times#20New` -> `Times New`. */
function decodeName(raw) {
  return raw.replace(NAME_ESC_RE, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** Token scanner over PDF syntax. Also used for content streams.
 * `data` is a byte-string (see module docstring). */
export class Lexer {
  constructor(data, pos = 0) {
    this.data = data;
    this.pos = pos;
  }

  /** Return [kind, value] or null at end of data. `kind` is one of "obj"
   * (a complete simple object), "kw", "aopen", "aclose", "dopen", "dclose". */
  nextToken() {
    const { data } = this;
    for (;;) {
      TOKEN_RE.lastIndex = this.pos;
      const m = TOKEN_RE.exec(data);
      if (m === null || m.index !== this.pos || TOKEN_RE.lastIndex === this.pos) return null;
      this.pos = TOKEN_RE.lastIndex;
      const g = m.groups;
      if (g.comment !== undefined) continue;
      if (g.name !== undefined) return ["obj", new PdfName(decodeName(g.name.slice(1)))];
      if (g.num !== undefined) {
        const raw = g.num.replace(/^\+*/, ""); // Python's raw.lstrip("+")
        if (raw.includes(".")) {
          const v = Number.parseFloat(raw);
          return ["obj", Number.isNaN(v) ? 0 : new PdfFloat(v)];
        }
        const v = Number.parseInt(raw, 10);
        return ["obj", Number.isNaN(v) ? 0 : v];
      }
      if (g.hex !== undefined) return ["obj", new PdfHexBytes(hexToByteString(g.hex.slice(1, -1)))];
      if (g.lit !== undefined) {
        const [s, end] = scanLiteralString(data, this.pos);
        this.pos = end;
        return ["obj", s];
      }
      if (g.kw !== undefined) {
        const kw = g.kw;
        if (kw === "true") return ["obj", true];
        if (kw === "false") return ["obj", false];
        if (kw === "null") return ["obj", null];
        return ["kw", new PdfKeyword(kw)];
      }
      if (g.dopen !== undefined) return ["dopen", null];
      if (g.dclose !== undefined) return ["dclose", null];
      if (g.aopen !== undefined) return ["aopen", null];
      if (g.aclose !== undefined) return ["aclose", null];
      if (g.popen !== undefined || g.pclose !== undefined) continue; // PostScript proc
      // "other": a single otherwise-unmatched byte, e.g. stray punctuation.
      return ["kw", new PdfKeyword(g.other)];
    }
  }
}

/** Fold trailing `n g R` triples on an operand stack into a PdfRef. */
function collapseRefs(stack) {
  const top = stack[stack.length - 1];
  if (stack.length >= 3 && top instanceof PdfKeyword && String(top) === "R") {
    const gen = stack[stack.length - 2];
    const num = stack[stack.length - 3];
    if (typeof num === "number" && typeof gen === "number") {
      stack.length -= 3;
      stack.push(new PdfRef(num, gen));
      return true;
    }
  }
  return false;
}

const isKeyword = (v) => v instanceof PdfKeyword;
const isIntLike = (v) => typeof v === "number" || typeof v === "boolean";

/** Parse the FIRST complete object in `data` (a byte-string); return it, or null. */
export function parseObject(data, pos = 0) {
  const lex = new Lexer(data, pos);
  const stack = [];
  const containers = []; // [{type: "a"|"d", mark}]
  for (;;) {
    const tok = lex.nextToken();
    if (tok === null) break;
    const [kind, value] = tok;
    if (kind === "aopen") { containers.push({ type: "a", mark: stack.length }); continue; }
    if (kind === "dopen") { containers.push({ type: "d", mark: stack.length }); continue; }
    if (kind === "aclose" || kind === "dclose") {
      if (!containers.length) continue;
      const { type, mark } = containers.pop();
      const items = stack.splice(mark);
      if (type === "a") {
        stack.push(items);
      } else {
        const d = new Map();
        for (let i = 0; i < items.length - 1; i += 2) {
          const key = items[i];
          if (key instanceof PdfName) d.set(String(key), items[i + 1]);
        }
        stack.push(d);
      }
    } else if (kind === "kw") {
      stack.push(value);
      collapseRefs(stack);
      if (!containers.length && (String(value) === "stream" || String(value) === "endobj")) break;
    } else {
      stack.push(value);
    }
    if (!containers.length && stack.length && !isKeyword(stack[stack.length - 1])) {
      if (stack.length === 1 && !isIntLike(stack[0])) return stack[0];
      if (stack[stack.length - 1] instanceof PdfRef) return stack[stack.length - 1];
    }
  }
  for (const item of stack) {
    if (!isKeyword(item)) return item;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. Encodings for simple fonts
// ═══════════════════════════════════════════════════════════════════════════

const UNI_NAME_RE = /^uni([0-9A-Fa-f]{4,6})$/;
const U_NAME_RE = /^u([0-9A-Fa-f]{4,6})$/;

/** Resolve a PostScript glyph name to text, or null. */
export function glyphNameToUnicode(name) {
  if (!name || name === ".notdef") return null;
  const hit = GLYPH_NAME_TO_UNICODE.get(name);
  if (hit !== undefined) return hit;
  let m = UNI_NAME_RE.exec(name);
  if (m) {
    const hex = m[1];
    let out = "";
    for (let i = 0; i < hex.length; i += 4) {
      out += pyChr(Number.parseInt(hex.slice(i, i + 4), 16));
    }
    return out;
  }
  m = U_NAME_RE.exec(name);
  if (m) {
    const cp = Number.parseInt(m[1], 16);
    return (cp >= 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) ? pyChr(cp) : null;
  }
  if (name.includes(".")) return glyphNameToUnicode(name.split(".", 1)[0]);
  if (Array.from(name).length === 1) return name;
  return null;
}

/** Build {code: text} for a simple font's /Encoding entry. Returns
 * [table (Map<int,string>), declared (bool)]. */
export function buildSimpleEncoding(encodingObj, resolve) {
  encodingObj = resolve(encodingObj);
  if (encodingObj instanceof PdfName) {
    const base = BASE_ENCODINGS.get(String(encodingObj));
    if (base === undefined) return [new Map(), false];
    return [new Map(base), true];
  }
  if (encodingObj instanceof Map) {
    const baseNameVal = resolve(encodingObj.get("BaseEncoding"));
    const base = baseNameVal instanceof PdfName ? BASE_ENCODINGS.get(String(baseNameVal)) : undefined;
    let declared = base !== undefined;
    const table = new Map(base !== undefined ? base : BASE_ENCODINGS.get("StandardEncoding"));
    const diffs = resolve(encodingObj.get("Differences"));
    if (Array.isArray(diffs)) {
      let code = 0;
      for (let item of diffs) {
        item = resolve(item);
        if (isNumeric(item)) {
          code = Math.trunc(toNumber(item));
        } else if (item instanceof PdfName) {
          const ch = glyphNameToUnicode(String(item));
          if (ch !== null) table.set(code, ch);
          else table.delete(code);
          code += 1;
        }
      }
      declared = true;
    }
    return [table, declared];
  }
  return [new Map(), false];
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. CMaps: code -> CID for composite (Type0) fonts
// ═══════════════════════════════════════════════════════════════════════════

/** Code-space ranges plus code -> CID mapping of an /Encoding CMap.
 * Identity-H/V (and any CMap we cannot read) behave as two-byte identity;
 * embedded CMap streams contribute their real codespacerange widths and
 * cidrange/cidchar mappings. */
export class CMapEncoding {
  constructor(identity = true) {
    this.identity = identity;
    this.widths = new Set();
    this.single = new Map();
    this.ranges = []; // [lo, hi, base]
  }

  codeLengths() {
    return this.widths.size ? Array.from(this.widths).sort((a, b) => a - b) : [2];
  }

  cidFor(code) {
    if (this.identity) return code;
    const cid = this.single.get(code);
    if (cid !== undefined) return cid;
    for (const [lo, hi, base] of this.ranges) {
      if (lo <= code && code <= hi) return base + (code - lo);
    }
    return code;
  }

  _inSpace(_code, width) {
    return this.widths.has(width);
  }

  /** Yield [code, cid, nbytes] for a shown byte-string. */
  * iterCodes(data) {
    const lengths = this.codeLengths();
    let i = 0;
    const n = data.length;
    while (i < n) {
      let matched = false;
      for (const width of lengths) {
        if (i + width <= n) {
          let code = 0;
          for (let k = 0; k < width; k += 1) code = code * 256 + data.charCodeAt(i + k);
          if (this.identity || width === lengths[lengths.length - 1] || this._inSpace(code, width)) {
            yield [code, this.cidFor(code), width];
            i += width;
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        const width = lengths[lengths.length - 1];
        let code = 0;
        for (let k = 0; k < width; k += 1) {
          code = code * 256 + (i + k < n ? data.charCodeAt(i + k) : 0);
        }
        yield [code, this.cidFor(code), width];
        i += width;
      }
    }
  }
}

const CODESPACE_RE = /begincodespacerange([\s\S]*?)endcodespacerange/g;
const CIDRANGE_RE = /begincidrange([\s\S]*?)endcidrange/g;
const CIDCHAR_RE = /begincidchar([\s\S]*?)endcidchar/g;
const HEXPAIR_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
const HEXNUM_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\d+)/g;
const HEXINT_RE = /<([0-9A-Fa-f]+)>\s*(\d+)/g;

/** Parse an embedded CMap stream (byte-string, or Buffer) into a CMapEncoding. */
export function parseCmapStream(data) {
  const text = Buffer.isBuffer(data) ? data.toString("latin1") : data;
  const enc = new CMapEncoding(false);
  let m;
  CODESPACE_RE.lastIndex = 0;
  while ((m = CODESPACE_RE.exec(text)) !== null) {
    HEXPAIR_RE.lastIndex = 0;
    let p;
    while ((p = HEXPAIR_RE.exec(m[1])) !== null) enc.widths.add(Math.max(1, Math.floor(p[1].length / 2)));
  }
  CIDRANGE_RE.lastIndex = 0;
  while ((m = CIDRANGE_RE.exec(text)) !== null) {
    HEXNUM_RE.lastIndex = 0;
    let p;
    while ((p = HEXNUM_RE.exec(m[1])) !== null) {
      enc.ranges.push([Number.parseInt(p[1], 16), Number.parseInt(p[2], 16), Number.parseInt(p[3], 10)]);
    }
  }
  CIDCHAR_RE.lastIndex = 0;
  while ((m = CIDCHAR_RE.exec(text)) !== null) {
    HEXINT_RE.lastIndex = 0;
    let p;
    while ((p = HEXINT_RE.exec(m[1])) !== null) {
      enc.single.set(Number.parseInt(p[1], 16), Number.parseInt(p[2], 10));
    }
  }
  if (!enc.widths.size) enc.widths.add(2);
  if (!enc.ranges.length && !enc.single.size) enc.identity = true;
  return enc;
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. Document-level decoding strategy + per-resource decoders
// ═══════════════════════════════════════════════════════════════════════════

/** Sentinel meaning "the content-stream code IS the Unicode code point". */
export const IDENTITY = Symbol("IDENTITY");

/** Font-cmap glyph map with the two decode truths for these books:
 *  - code 0x0000 is the .notdef glyph = tab/space -> decode as a space;
 *  - an unmapped code that is a valid code point comes from the few fonts
 *    that encode with EXACT Unicode code points -> decode as chr(code).
 *  Every other unmapped code stays a [XXXX] placeholder (real gap). */
export class CmapIdentityMap extends Map {}

/** Marker for a map whose decoded text is in Ayar legacy order. */
export class LegacyAyarMap extends Map {}

const isSurrogate = (cp) => cp >= 0xd800 && cp <= 0xdfff;

// Python `unicodedata.category(ch)[0] not in 'CC'` — i.e. NOT a Cc, Cf, Cs,
// Co (private use) or Cn (unassigned) code point. Node's RegExp Unicode
// property escapes query the real Unicode category database directly
// (General_Category=Cn is itself a queryable property in V8/ICU), instead
// of a hand-rolled range list that previously missed Co/Cn entirely.
// Known gap: Node's bundled ICU and Python's `unicodedata` module ship
// different Unicode versions, so ~0.2% of exotic/very-recently-assigned
// code points (verified on brand-new script blocks, none of them ever
// produced by a real Myanmar PDF's font codes) can disagree at the Cn/
// assigned boundary. Not worth hand-maintaining a duplicate category table
// to close a gap no real document can reach.
const CATEGORY_C_RE = /\p{Cc}|\p{Cf}|\p{Co}|\p{Cs}|\p{Cn}/u;
function isCategoryC(ch) {
  return CATEGORY_C_RE.test(ch);
}

/** map_code(): codeToUni is IDENTITY | Map<gid,int codepoint> | Map<code,str>. */
export function mapCode(codeToUni, cid) {
  if (codeToUni === IDENTITY) {
    if (cid >= 0 && cid <= 0x10ffff && !isSurrogate(cid)) return pyChr(cid);
    return null;
  }
  const v = codeToUni.get(cid);
  if (v === undefined) {
    if (codeToUni instanceof CmapIdentityMap) {
      if (cid === 0) return " "; // .notdef glyph = tab/space
      if (cid >= 0x20 && cid <= 0x10ffff && !isSurrogate(cid)) {
        const ch = pyChr(cid);
        if (!isCategoryC(ch)) return ch; // exact-Unicode font, identity decode
      }
    }
    return null;
  }
  return typeof v === "number" ? pyChr(v) : v;
}

/** Filter a /ToUnicode map, or return null when it carries nothing.
 * Copy-protected PDFs ship *blanked* ToUnicode maps (nearly every code maps
 * to a space) as decoys; only non-space entries survive when so detected. */
export function usableToUnicode(mapping) {
  if (!mapping || !mapping.size) return null;
  let spaces = 0;
  for (const v of mapping.values()) if (v === " ") spaces += 1;
  if (spaces / mapping.size > 0.9) {
    const filtered = new Map();
    for (const [k, v] of mapping) if (v !== " ") filtered.set(k, v);
    mapping = filtered;
  }
  return mapping.size ? mapping : null;
}

/** The document-wide decoding *fallback*, plus a per-resource decoder cache.
 *
 * `kind`: "identity" direct decode; "cmap" reversed embedded cmap (keyed by
 * GLYPH ID); "legacy" legacy character-code map (Arlarwade/Ayar); "tounicode"
 * merged /ToUnicode (+ sidecar), keyed by code; "none" nothing available. */
export class DocumentDecoding {
  constructor(kind, mapping = null, legacyCodePage = null) {
    this.kind = kind;
    this.map = kind === "identity" ? IDENTITY : (mapping || new Map());
    // A reversed font cmap is keyed by glyph id; every other source is keyed
    // by the content-stream code itself.
    this.keyKind = kind === "cmap" ? "gid" : "code";
    this.trustFontToUnicode = kind === "tounicode" || kind === "none";
    this.legacyTextFix = kind === "legacy";
    this.legacyCodePage = legacyCodePage;
    // Filled in by the extractor: one FontResourceLoader per document.
    this.loader = null;
    this._decoders = new Map();
    this._pageFonts = new Map();
  }

  resetFontCache() {
    this._decoders.clear();
    this._pageFonts.clear();
  }
}

/** Accept either a DocumentDecoding or a legacy bare map. */
export function asDocumentDecoding(decoding) {
  if (decoding instanceof DocumentDecoding) return decoding;
  if (decoding === IDENTITY) return new DocumentDecoding("identity");
  if (decoding instanceof LegacyAyarMap) return new DocumentDecoding("legacy", decoding);
  if (decoding instanceof CmapIdentityMap) return new DocumentDecoding("cmap", decoding);
  if (!decoding || (decoding instanceof Map && decoding.size === 0)) return new DocumentDecoding("none");
  return new DocumentDecoding("tounicode", decoding);
}

/** Reads fonts out of a parsed PDF. The three stream primitives are injected
 * so this module never imports pdf-extract.mjs. */
export class FontResourceLoader {
  constructor(objects, getStream, parseTtfCmap, parseToUnicodeStream) {
    this.objects = objects;
    this._getStream = getStream;
    this._parseTtfCmap = parseTtfCmap;
    this._parseToUnicode = parseToUnicodeStream;
    this._objCache = new Map();
    this._gidCache = new Map();
    this._tuCache = new Map();
  }

  objectValue(ref) {
    const key = ref.key();
    if (this._objCache.has(key)) return this._objCache.get(key);
    let raw = this.objects.get(key);
    if (raw === undefined && ref.gen !== 0) raw = this.objects.get(`${ref.num},0`);
    const value = raw ? parseObject(raw.toString("latin1")) : null;
    this._objCache.set(key, value);
    return value;
  }

  resolve(value, depth = 0) {
    while (value instanceof PdfRef && depth < 32) {
      value = this.objectValue(value);
      depth += 1;
    }
    return value;
  }

  streamOf(ref) {
    if (!(ref instanceof PdfRef)) return null;
    return this._getStream(this.objects, ref.num, ref.gen);
  }

  /** {glyph id: unicode} for a descriptor's embedded font program. */
  reversedFontCmap(descriptor) {
    descriptor = this.resolve(descriptor);
    if (!(descriptor instanceof Map)) return new Map();
    for (const key of ["FontFile2", "FontFile3", "FontFile"]) {
      const ref = descriptor.get(key);
      if (!(ref instanceof PdfRef)) continue;
      const cacheKey = ref.key();
      if (this._gidCache.has(cacheKey)) return this._gidCache.get(cacheKey);
      const data = this.streamOf(ref);
      const table = new Map();
      if (data) {
        const cmap = this._parseTtfCmap(data) || new Map();
        for (const [uni, gid] of cmap) {
          if (gid && !table.has(gid)) table.set(gid, uni);
        }
      }
      this._gidCache.set(cacheKey, table);
      return table;
    }
    return new Map();
  }

  /** The font's OWN /ToUnicode map, decoy-filtered (or null). */
  tounicodeOf(fontDict) {
    const ref = fontDict.get("ToUnicode");
    if (!(ref instanceof PdfRef)) return null;
    const cacheKey = ref.key();
    if (this._tuCache.has(cacheKey)) return this._tuCache.get(cacheKey);
    const data = this.streamOf(ref);
    const mapping = data ? usableToUnicode(this._parseToUnicode(data)) : null;
    this._tuCache.set(cacheKey, mapping);
    return mapping;
  }

  /** Return a callable CID -> GID for a descendant CIDFont, or null (Identity). */
  cidToGid(descendant) {
    const entry = descendant.get("CIDToGIDMap");
    if (entry instanceof PdfRef) {
      const data = this.streamOf(entry);
      if (data && data.length) {
        const count = Math.floor(data.length / 2);
        const gids = new Array(count);
        for (let i = 0; i < count; i += 1) gids[i] = data.readUInt16BE(i * 2);
        return (cid) => (cid >= 0 && cid < gids.length ? gids[cid] : 0);
      }
    }
    return null;
  }

  /** {resource name: font dict} for a page, walking the inheritable /Parent chain. */
  pageFontResources(pageNum, pageGen = 0) {
    let page = this.resolve(new PdfRef(pageNum, pageGen));
    const fonts = new Map();
    const seen = new Set();
    let depth = 0;
    while (page instanceof Map && depth < 32) {
      const resources = this.resolve(page.get("Resources"));
      if (resources instanceof Map) {
        const fontDict = this.resolve(resources.get("Font"));
        if (fontDict instanceof Map) {
          for (const [name, entry] of fontDict) {
            if (!fonts.has(name)) fonts.set(name, entry);
          }
        }
      }
      const parent = page.get("Parent");
      if (!(parent instanceof PdfRef) || seen.has(parent.key())) break;
      seen.add(parent.key());
      page = this.resolve(parent);
      depth += 1;
    }
    return fonts;
  }
}

/** Find simple fonts that paint Myanmar from Latin/ASCII slots — identified
 * structurally (simple font, no /Encoding, /ToUnicode returns mostly
 * non-Myanmar characters), never by name. Returns a list of PdfRef. */
export function detectLegacyLayoutFonts(objects, getStreamFn, parseToUnicodeFn) {
  const found = [];
  const subtypeRe = /\/Subtype\s*\/(TrueType|Type1|MMType1)\b/;
  const encodingRe = /\/Encoding\s*(\/|\d)/;
  const touRe = /\/ToUnicode\s+(\d+)\s+(\d+)\s+R/;
  for (const [key, body] of objects) {
    if (!Buffer.isBuffer(body)) continue;
    const text = body.toString("latin1");
    if (!text.includes("/Subtype") || !text.includes("/ToUnicode")) continue;
    if (!subtypeRe.test(text)) continue;
    if (encodingRe.test(text)) continue;
    const m = touRe.exec(text);
    if (!m) continue;
    let mapping;
    try {
      const raw = getStreamFn(objects, Number.parseInt(m[1], 10), Number.parseInt(m[2], 10));
      mapping = raw ? parseToUnicodeFn(raw) : new Map();
    } catch {
      continue;
    }
    if (!mapping || !mapping.size) continue;
    let totalChars = 0;
    let myanmar = 0;
    for (const v of mapping.values()) {
      for (const ch of v) {
        totalChars += 1;
        const cp = ch.codePointAt(0);
        if (cp >= 0x1000 && cp <= 0x109f) myanmar += 1;
      }
    }
    if (!totalChars) continue;
    if (myanmar / totalChars < 0.25) {
      const [numStr, genStr] = key.split(",");
      found.push(new PdfRef(Number.parseInt(numStr, 10), Number.parseInt(genStr, 10)));
    }
  }
  return found;
}

/** Decodes shown strings for ONE /Font resource. */
export class FontDecoder {
  constructor(name, {
    subtype = "", baseFont = "", isCid = false, cmap = null, toUnicode = null,
    encoding = null, hasEncoding = false, ownGids = null, doc = null, cidToGid = null,
  } = {}) {
    this.name = name;
    this.subtype = subtype;
    this.baseFont = baseFont;
    this.isCid = isCid;
    this.cmap = cmap || new CMapEncoding(true);
    this.toUnicode = toUnicode;
    this.encoding = encoding || new Map();
    this.hasEncoding = hasEncoding;
    this.ownGids = ownGids || new Map();
    this.doc = doc !== null ? doc : new DocumentDecoding("none");
    this._cidToGid = cidToGid;
  }

  get _trustedToUnicode() {
    return (this.toUnicode && this.doc.trustFontToUnicode) ? this.toUnicode : null;
  }

  /** Decode `code` through this resource's own subset numbering (legacy). */
  _legacyLookup(code) {
    const page = this.doc.legacyCodePage;
    if (!page || !this.toUnicode) return null;
    const src = this.toUnicode.get(code);
    if (!src) return null;
    let out = "";
    for (const ch of src) {
      const hit = page.get(ch.codePointAt(0));
      if (hit === undefined) return null;
      out += hit;
    }
    return out;
  }

  /** Document-level map lookup, own-font glyph map first. */
  _docLookup(key) {
    if (this.doc.map === IDENTITY) return mapCode(IDENTITY, key);
    if (this.doc.keyKind === "gid" && this.ownGids.size) {
      const hit = this.ownGids.get(key);
      if (hit !== undefined) return typeof hit === "number" ? pyChr(hit) : hit;
    }
    return mapCode(this.doc.map, key);
  }

  gidFor(cid) {
    if (this._cidToGid === null || this._cidToGid === undefined) return cid;
    return this._cidToGid(cid);
  }

  /** Decode ONE character code to text (null when unmapped). */
  decodeCode(code, cid = null) {
    const tu = this._trustedToUnicode;
    if (tu !== null) {
      const hit = tu.get(code);
      if (hit !== undefined) return hit;
    }
    if (!this.isCid) {
      if (this.hasEncoding) {
        // The font DECLARED what its codes mean — never fall through to the
        // document-level glyph map here.
        const hit = this.encoding.get(code);
        return hit === undefined ? null : hit;
      }
      const bridged = this._legacyLookup(code);
      if (bridged !== null) return bridged;
      return this._docLookup(code);
    }
    cid = cid === null ? code : cid;
    const key = (this.doc.keyKind === "code" || this.doc.map === IDENTITY) ? cid : this.gidFor(cid);
    return this._docLookup(key);
  }

  /** Decode a shown string (byte-string) with this font's rules. */
  decode(data) {
    if (!data) return "";
    let out = "";
    if (this.isCid) {
      for (const [code, cid] of this.cmap.iterCodes(data)) {
        const text = this.decodeCode(code, cid);
        out += text !== null ? text : `[${code.toString(16).toUpperCase().padStart(4, "0")}]`;
      }
      return out;
    }
    for (let i = 0; i < data.length; i += 1) {
      const code = data.charCodeAt(i);
      let text = this.decodeCode(code);
      if (text === null) {
        text = ((code < 0x20 || (code >= 0x7f && code <= 0x9f)) && code !== 0x09 && code !== 0x0a && code !== 0x0d)
          ? "" : pyChr(code);
      }
      out += text;
    }
    return out;
  }
}

/** Decoder used for text shown before any Tf selects a resource. Hex strings
 * keep their two-byte reading, literal strings their one-byte reading. */
export class UnsetFontDecoder extends FontDecoder {
  decode(data) {
    if (!data) return "";
    if (data instanceof PdfHexBytes) {
      const s = data.s;
      let out = "";
      for (let i = 0; i + 1 < s.length; i += 2) {
        const code = (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1);
        const text = this._docLookup(code);
        out += text !== null ? text : `[${code.toString(16).toUpperCase().padStart(4, "0")}]`;
      }
      return out;
    }
    let out = "";
    for (let i = 0; i < data.length; i += 1) {
      const code = data.charCodeAt(i);
      const text = this._docLookup(code);
      out += text !== null ? text : pyChr(code);
    }
    return out;
  }
}

/** Build the FontDecoder for one /Font resource entry. */
export function buildFontDecoder(loader, name, entry, doc) {
  const font = loader.resolve(entry);
  if (!(font instanceof Map)) return new FontDecoder(name, { doc });
  const subtype = font.get("Subtype") instanceof PdfName ? String(loader.resolve(font.get("Subtype"))) : "";
  const baseFontVal = loader.resolve(font.get("BaseFont"));
  const baseFont = baseFontVal !== undefined && baseFontVal !== null ? String(baseFontVal) : "";
  const toUnicode = loader.tounicodeOf(font);

  if (subtype === "Type0") {
    const encodingRaw = font.get("Encoding");
    const encoding = loader.resolve(encodingRaw);
    let cmap;
    if (encoding instanceof PdfName) {
      cmap = new CMapEncoding(true); // Identity-H/V + predefined
    } else if (encodingRaw instanceof PdfRef) {
      const data = loader.streamOf(encodingRaw);
      cmap = data ? parseCmapStream(data) : new CMapEncoding(true);
    } else {
      cmap = new CMapEncoding(true);
    }
    const descendants = loader.resolve(font.get("DescendantFonts"));
    let descendant = new Map();
    if (Array.isArray(descendants) && descendants.length) {
      const resolved = loader.resolve(descendants[0]);
      if (resolved instanceof Map) descendant = resolved;
    }
    const ownGids = loader.reversedFontCmap(descendant.get("FontDescriptor"));
    return new FontDecoder(name, {
      subtype, baseFont, isCid: true, cmap, toUnicode, ownGids, doc,
      cidToGid: loader.cidToGid(descendant),
    });
  }

  const [encoding, declared] = buildSimpleEncoding(font.get("Encoding"), (v) => loader.resolve(v));
  const ownGids = loader.reversedFontCmap(font.get("FontDescriptor"));
  return new FontDecoder(name, {
    subtype, baseFont, isCid: false, toUnicode, encoding, hasEncoding: declared, ownGids, doc,
  });
}

/** {resource name: FontDecoder} for a page (cached per font object). */
export function pageFontDecoders(loader, pageNum, pageGen, doc) {
  const cacheKey = `${pageNum},${pageGen}`;
  if (doc._pageFonts.has(cacheKey)) return doc._pageFonts.get(cacheKey);
  const decoders = new Map();
  for (const [name, entry] of loader.pageFontResources(pageNum, pageGen)) {
    const key = entry instanceof PdfRef ? entry.key() : `${pageNum},${pageGen},${name}`;
    let decoder = doc._decoders.get(key);
    if (decoder === undefined) {
      decoder = buildFontDecoder(loader, name, entry, doc);
      doc._decoders.set(key, decoder);
    }
    decoders.set(name, decoder);
  }
  doc._pageFonts.set(cacheKey, decoders);
  return decoders;
}
