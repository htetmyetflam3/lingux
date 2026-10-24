/**
 * TTF tables the PDF writer needs: unitsPerEm, hhea ascent/descent, hmtx advance
 * widths and a unicode -> glyph-id map.
 *
 * The advance-width rounding matches fpdf2 exactly — `round(scale * w + 0.001)`
 * with scale = 1000/upem (fpdf/fonts.py:550, commented ROUND_HALF_UP). That is
 * not decoration: the width total decides horizontal centring of the page number,
 * and /W decides what a PDF reader reports for the line, which the parity test
 * reads back out of the produced file.
 *
 * No subsetting: fpdf2 subsets the embedded font via fonttools, which has no
 * Node standard-library equivalent. Embedding the whole face costs file size and
 * changes nothing about layout or extracted text.
 */
import fs from "node:fs";
import { parseTtfCmap } from "./pdf-extract.mjs";

function readTableDirectory(data) {
  const numTables = data.readUInt16BE(4);
  const tables = new Map();
  let off = 12;
  for (let i = 0; i < numTables; i += 1) {
    if (off + 16 > data.length) break;
    const tag = data.toString("latin1", off, off + 4);
    tables.set(tag, { offset: data.readUInt32BE(off + 8), length: data.readUInt32BE(off + 12) });
    off += 16;
  }
  return tables;
}

export class TtfFont {
  constructor(filePath) {
    this.path = filePath;
    this.data = fs.readFileSync(filePath);
    const tables = readTableDirectory(this.data);
    this.tables = tables;

    const head = tables.get("head");
    if (!head) throw new Error(`${filePath} is not a TrueType font (no head table)`);
    this.unitsPerEm = this.data.readUInt16BE(head.offset + 18);
    this.indexToLocFormat = this.data.readInt16BE(head.offset + 50);
    // head.xMin yMin xMax yMax (int16 at 36,38,40,42)
    this.bbox = [
      this.data.readInt16BE(head.offset + 36),
      this.data.readInt16BE(head.offset + 38),
      this.data.readInt16BE(head.offset + 40),
      this.data.readInt16BE(head.offset + 42),
    ];

    const hhea = tables.get("hhea");
    this.ascent = hhea ? this.data.readInt16BE(hhea.offset + 4) : this.unitsPerEm;
    this.descent = hhea ? this.data.readInt16BE(hhea.offset + 6) : -this.unitsPerEm;
    this.numberOfHMetrics = hhea ? this.data.readUInt16BE(hhea.offset + 34) : 0;

    const maxp = tables.get("maxp");
    this.numGlyphs = maxp ? this.data.readUInt16BE(maxp.offset + 4) : 0;

    // hmtx: numberOfHMetrics entries of (advanceWidth long, lsb short), then the
    // remaining glyphs repeat the last advanceWidth.
    this.advanceWidths = new Uint16Array(this.numGlyphs);
    const hmtx = tables.get("hmtx");
    if (hmtx && this.numGlyphs) {
      let p = hmtx.offset;
      let last = 600;
      for (let g = 0; g < this.numGlyphs; g += 1) {
        if (g < this.numberOfHMetrics) {
          if (p + 2 > this.data.length) break;
          last = this.data.readUInt16BE(p);
          p += 4; // advanceWidth + lsb
        }
        this.advanceWidths[g] = last;
      }
    }

    // codepoint -> glyph id (format 4/6/12 subtables, the same reader the PDF
    // side uses for embedded fonts).
    this.cmap = parseTtfCmap(this.data); // Map<codepoint, gid>

    // fpdf2's scale + width rounding, per codepoint.
    this.scale = 1000 / this.unitsPerEm;
    this.cw = new Map();
    for (const [cp, gid] of this.cmap) {
      const w = this.advanceWidths[gid] ?? 0;
      this.cw.set(cp, roundHalfUp(this.scale * (w === 65535 ? 0 : w) + 0.001));
    }

    this.name = sanitizeName(filePath);
    this.usedCps = new Set(); // filled by the PDF writer with what is actually drawn
    // Notdef advance, used for characters the face has no glyph for.
    this.notdefWidth = roundHalfUp(this.scale * (this.advanceWidths[0] ?? 0) + 0.001);
  }

  hasCodepoint(cp) {
    return this.cmap.has(cp);
  }

  glyphId(cp) {
    const gid = this.cmap.get(cp);
    return gid === undefined ? 0 : gid;
  }

  widthOf(cp) {
    const w = this.cw.get(cp);
    return w === undefined ? this.notdefWidth : w;
  }

  /** sum(cw) * size_pt * 0.001 — TextLine fragment width in points. */
  textWidthPt(text, sizePt) {
    let total = 0;
    for (const ch of text) total += this.widthOf(ch.codePointAt(0));
    return total * sizePt * 0.001;
  }
}

// Python's round() on (x + 0.001) with the ROUND_HALF_UP comment in fpdf2.
function roundHalfUp(x) {
  return Math.round(x);
}

function sanitizeName(filePath) {
  const base = filePath.split(/[\\/]/).pop() || "Font";
  return base.replace(/\.ttf$/i, "").replace(/[^A-Za-z0-9-]/g, "");
}

export function loadFont(filePath) {
  return new TtfFont(filePath);
}
