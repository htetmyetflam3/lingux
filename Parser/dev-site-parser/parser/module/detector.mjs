/**
 * Port of detector.py — Zawgyi/Unicode detector over Google's binary Markov model
 * (zawgyiUnicodeModel.dat), no dependencies.
 *
 * Why this is a re-implementation and not an npm package: the pipeline classifies
 * EVERY page with it, and the page-level ZAWGYI/UNICODE decision is what picks the
 * Rabbit conversion and the cleanup. So the scorer has to agree with the Python
 * bit-for-bit — same params, same state table, same float path.
 *
 * Two behaviours are load-bearing and look like bugs until you read them twice:
 *
 *  1. `chars` is NOT sorted (EXA=U+AA60.. comes before EXB=U+A9E0.., and the SPC
 *     block U+2000.. comes last). `bisect_left` on an unsorted table returns an
 *     arbitrary position, and the `chars[i] === char` guard then fails — so the
 *     A9Ex and U+200x groups score as FOREIGN (state 0). The table order is kept
 *     verbatim and the real bisection is performed, so the JS scorer inherits the
 *     exact same behaviour. A Map-based lookup would silently re-score text.
 *
 *  2. `params` is a float32 array (`array('f')`) with rows filled from a base
 *     value then patched by sparse pairs, and `params[0]` forced to NaN. Rows
 *     whose count is 0 stay 0.0 (not NaN). "All NaN" is therefore exactly
 *     "every character is foreign", which is what makes detect() return -inf.
 */

import fs from "node:fs";

const STD = [0x1000, 0x103f];
const AFT = [0x104a, 0x109f];
const EXA = [0xaa60, 0xaa7f];
const EXB = [0xa9e0, 0xa9ff];
const SPC = [0x2000, 0x200b];

function chainRanges(ranges) {
  const out = [];
  for (const [lo, hi] of ranges) {
    for (let c = lo; c <= hi; c += 1) out.push(c);
  }
  return out;
}

/** bisect_left over a code-point array (Python bisect_left over the `chars` str). */
function bisectLeft(a, key) {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }

  read(n) {
    if (this.pos + n > this.buf.length) {
      throw new RangeError(`read ${n} bytes past end of model file`);
    }
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  int32() { return this.read(4).readInt32BE(0); }   // struct '>i'
  int16() { return this.read(2).readInt16BE(0); }   // struct '>h'
  float() { return this.read(4).readFloatBE(0); }    // struct '>f'
}

export class ZawgyiDetector {
  constructor(modelPath) {
    const buf = Buffer.isBuffer(modelPath) || modelPath instanceof Uint8Array
      ? Buffer.from(modelPath.buffer, modelPath.byteOffset, modelPath.byteLength)
      : fs.readFileSync(modelPath);
    const stream = new Reader(buf);

    const uzmodelTag = stream.read(8).toString("latin1");
    if (uzmodelTag !== "UZMODEL ") throw new Error("invalid uzmodel_tag");

    const uzmodelVersion = stream.int32();
    let ssv;
    if (uzmodelVersion === 1) ssv = 0;
    else if (uzmodelVersion === 2) ssv = stream.int32();
    else throw new Error("invalid uzmodel_version");

    let ranges;
    if (ssv === 0) ranges = [STD, AFT, EXA, EXB, SPC];
    else if (ssv === 1) ranges = [STD, AFT, EXA, EXB];
    else throw new Error("invalid ssv");
    const chars = chainRanges(ranges);

    if (stream.read(8).toString("latin1") !== "BMARKOV ") throw new Error("invalid bmarkov_tag");
    if (stream.int32() !== 0) throw new Error("invalid bmarkov_version");

    const size = stream.int16();
    // array('f', repeat(0.0, size*size)) — float32, exactly like the Python model.
    const params = new Float32Array(size * size);
    for (let i = 0; i < size; i += 1) {
      const count = stream.int16();
      if (count === 0) continue; // row stays all-zero, as in Python
      const offset = i * size;
      const baseValue = stream.float();
      params.fill(baseValue, offset, offset + size);
      for (let k = 0; k < count; k += 1) {
        const index = stream.int16();
        const value = stream.float();
        params[offset + index] = value;
      }
    }
    // struct.iter_unpack('>hf') — Python reads the whole block first, then applies.
    // The order above is identical (index/value interleaved), so no divergence.

    params[0] = NaN; // node 0 is for foreign characters

    this._chars = chars;
    this._params = params;
    this._size = size;
    this._modelVersion = uzmodelVersion;
    this._ssv = ssv;
  }

  /** Return state index for a code point (0 = foreign/unknown). */
  state(codePoint) {
    if (codePoint === null || codePoint === undefined) return 0;
    const i = bisectLeft(this._chars, codePoint);
    if (i < this._chars.length && this._chars[i] === codePoint) return i + 1;
    return 0;
  }

  /** Log-likelihood ratios for consecutive character pairs (incl. both ends). */
  _llrs(codePoints) {
    const size = this._size;
    const params = this._params;
    const states = new Int32Array(codePoints.length + 2);
    states[0] = 0;
    for (let i = 0; i < codePoints.length; i += 1) states[i + 1] = this.state(codePoints[i]);
    states[codePoints.length + 1] = 0;
    const out = new Float64Array(codePoints.length + 1);
    for (let i = 0; i < codePoints.length + 1; i += 1) {
      out[i] = params[states[i] * size + states[i + 1]];
    }
    return out;
  }

  /**
   * Probability that `string` is Zawgyi-encoded.
   * -Infinity when the string contains only foreign characters.
   */
  getZawgyiProbability(string) {
    const codePoints = Array.from(string, (ch) => ch.codePointAt(0));
    const llrs = this._llrs(codePoints);
    let anyReal = false;
    for (let i = 0; i < llrs.length; i += 1) {
      if (!Number.isNaN(llrs[i])) { anyReal = true; break; }
    }
    if (!anyReal) return -Infinity;
    let total = 0;
    for (let i = 0; i < llrs.length; i += 1) {
      const x = llrs[i];
      if (!Number.isNaN(x)) total += x;
    }
    if (total >= 0) {
      const z = Math.exp(-total);
      return z / (z + 1);
    }
    return 1 / (1 + Math.exp(total));
  }

  /** ["ZAWGYI" | "UNICODE" | "UNKNOWN", probability] */
  detect(string, threshold = 0.5) {
    const prob = this.getZawgyiProbability(string);
    if (prob === -Infinity) return ["UNKNOWN", prob];
    if (prob > threshold) return ["ZAWGYI", prob];
    return ["UNICODE", prob];
  }
}

