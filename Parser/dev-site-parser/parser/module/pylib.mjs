/**
 * Python-semantics helpers. Every one of these exists because the Node port has
 * to reproduce a Python behaviour, not a JavaScript one. Each is noted with the
 * call site that needs it.
 */

/** Python bool(x) for the container types this port uses (dict/list/str/bytes).
 *  An empty Map/Set/Buffer is TRUE in JS but FALSE in Python, and that difference
 *  picks the PDF decode source (pipeline.py `if cmap_map:` / `elif tu_map:`). */
export function pyTruthy(x) {
  if (x === null || x === undefined) return false;
  if (typeof x === "boolean") return x;
  if (typeof x === "number") return x !== 0;
  if (typeof x === "string") return x.length > 0;
  if (Array.isArray(x)) return x.length > 0;
  if (Buffer.isBuffer(x)) return x.length > 0;
  if (x instanceof Map || x instanceof Set) return x.size > 0;
  return true;
}

/** Python round() with no ndigits: half-to-even, returns an int.
 *  Used by render._layout_para / _sect_pr (w:before, w:ind, w:sz, w:pgSz). */
export function pyRound(x) {
  if (!Number.isFinite(x)) {
    throw new RangeError(`cannot round ${x}`); // Python: OverflowError / ValueError
  }
  const fl = Math.floor(x);
  const diff = x - fl;
  if (diff > 0.5) return fl + 1;
  if (diff < 0.5) return fl;
  return fl % 2 === 0 ? fl : fl + 1;
}

/** Python bytes.strip() — ASCII whitespace only (b' \t\n\r\x0b\x0c').
 *  NOT String.prototype.trim(), which also eats U+00A0/U+2028/U+FEFF.
 *  Zero-copy: returns a view, since every offset the parser uses is relative. */
const PY_WS = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c]);
export function pyStripBytes(buf) {
  let i = 0;
  let j = buf.length;
  while (i < j && PY_WS.has(buf[i])) i += 1;
  while (j > i && PY_WS.has(buf[j - 1])) j -= 1;
  return buf.subarray(i, j);
}

/** Python `bytes.fromhex(s)`: odd length or non-hex raises ValueError. */
export function fromHexStrict(hex) {
  if (hex.length % 2 !== 0) {
    throw new TypeError(`non-hexadecimal number found in fromhex() arg at position ${hex.length - 1}`);
  }
  if (!/^[0-9A-Fa-f]*$/.test(hex)) {
    const bad = hex.search(/[^0-9A-Fa-f]/);
    throw new TypeError(`non-hexadecimal number found in fromhex() arg at position ${bad}`);
  }
  return Buffer.from(hex, "hex");
}

/** Python `int(s, 16)`: accepts an optional 0x prefix, surrounding whitespace and
 *  `_` separators; REJECTS trailing garbage (parseInt would not). */
export function pyInt16(s) {
  let t = String(s).trim().replace(/_/g, "");
  let sign = 1n;
  if (t.startsWith("+")) t = t.slice(1);
  else if (t.startsWith("-")) { sign = -1n; t = t.slice(1); }
  if (/^0[xX]/.test(t)) t = t.slice(2);
  if (!/^[0-9A-Fa-f]+$/.test(t)) throw new ValueError(`invalid literal for int() with base 16: '${s}'`);
  const v = BigInt(`0x${t}`) * sign;
  if (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(v);
  return v; // Python ints are unbounded; callers that index by it keep a BigInt
}

/** Python `int(s)` for decimal strings (object numbers, generation numbers). */
export function pyInt(s) {
  const t = String(s).trim().replace(/_/g, "");
  if (!/^[+-]?\d+$/.test(t)) throw new ValueError(`invalid literal for int() with base 10: '${s}'`);
  const v = BigInt(t);
  if (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(v);
  return v;
}

export class ValueError extends Error {
  constructor(msg) { super(msg); this.name = "ValueError"; }
}
export class RuntimeError extends Error {
  constructor(msg) { super(msg); this.name = "RuntimeError"; }
}

/** Python `chr(i)` — validates range like CPython does (surrogates allowed, as
 *  CPython permits lone surrogates in str; anything else out of range throws). */
export function pyChr(i) {
  if (typeof i === "bigint") i = Number(i);
  if (i < 0 || i > 0x10ffff) {
    throw new ValueError(`chr() arg not in range(0x110000)`);
  }
  return String.fromCodePoint(i);
}

/** Python's str comparison (code points), for sort keys like (x, text).
 *  JS `<` compares UTF-16 code units, which reorders astral vs private-use. */
export function pyStrCompare(a, b) {
  const ka = Array.from(a);
  const kb = Array.from(b);
  const n = Math.min(ka.length, kb.length);
  for (let i = 0; i < n; i += 1) {
    const ca = ka[i].codePointAt(0);
    const cb = kb[i].codePointAt(0);
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
  if (ka.length === kb.length) return 0;
  return ka.length < kb.length ? -1 : 1;
}

/** Python `len(str)` — code points, not UTF-16 units (classify_text_role's
 *  `2 <= len(s) <= 60` counts characters). */
export function pyLen(str) {
  let n = 0;
  for (const _ch of str) n += 1;
  return n;
}

/** os.path.splitext(): splits on the LAST dot of the BASE name only. */
export function splitExt(p) {
  const base = p.split(/[\\/]/).pop();
  const idx = base.lastIndexOf(".");
  const lastSep = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
  if (idx <= 0 || idx < lastSep) return [p, ""];
  return [p.slice(0, p.length - (base.length - idx)), base.slice(idx).toLowerCase()];
}

/** os.path.basename */
export function baseName(p) {
  const t = String(p).replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
  return i === -1 ? t : t.slice(i + 1);
}

/** Python float(s): rejects multiple dots ("1.2.3"), unlike parseFloat. The PDF
 *  numeric tokens are matched by [\d.]+, so a malformed token must raise. */
export function pyFloat(s) {
  const t = String(s).trim().replace(/_/g, "");
  if (t === "nan" || t === "inf" || t === "-inf" || t === "+inf") return Number(t);
  if (!/^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    throw new ValueError(`could not convert string to float: '${s}'`);
  }
  return Number(t);
}
