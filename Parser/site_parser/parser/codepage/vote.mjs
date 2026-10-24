/**
 * FILE: Parsed/parser/codepage/vote.mjs
 *
 * Build a code page for a document that no registered code page explains, by
 * looking at the pixels the PDF actually draws.
 *
 * For each source byte the registered code pages DISAGREE on, the rendered
 * pixels of that region are matched against the labelled SVG sheets (shape/).
 * An unambiguous match wins the slot; an ambiguous crop abstains and the
 * strongest registered code page fills it. Agreement is never voted on -- no
 * work is done where the registry already agrees.
 *
 * The result is a candidate table, not a verdict: codepage/resolve.mjs scores it
 * beside the registered ones, so a weak auto-build cannot bypass the quality
 * floor. The embedded font program is never opened on this path.
 *
 * Split out of the former module/vector-repair.mjs, which held both this and the
 * pure shape maths now in shape/match.mjs. Logic unchanged.
 */

import {
  cropCanvasRgba,
  decodeImageRgba,
  openPdf,
  pageTextCharacters,
  renderPageCanvas,
} from "../read/pdf-render.mjs";
import { englishLikeness } from "../text/mm-score.mjs";
import { legacyFontFaces } from "../read/pdf-fonts.mjs";
import { getStream, parsePdfObjects, parseToUnicodeStream } from "../read/pdf-extract.mjs";
import { binarise } from "../shape/raster.mjs";
import { getDefaultVectorIndex, matchRasterMask } from "../shape/match.mjs";
import { emitEvent } from "../../../logen/core.js";

function grayFromRgba({ data, width, height }) {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const at = i * 4;
    // Composite transparent pixels onto white before thresholding.
    const alpha = data[at + 3] / 255;
    const r = data[at] * alpha + 255 * (1 - alpha);
    const g = data[at + 1] * alpha + 255 * (1 - alpha);
    const b = data[at + 2] * alpha + 255 * (1 - alpha);
    gray[i] = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
  }
  return { gray, width, height };
}

/** Map RGBA page pixels to SVG labels: composite, threshold, measure. Synchronous. */
export function matchPixelsToVector({ data, width, height }, options = {}) {
  const { gray } = grayFromRgba({ data, width, height });
  return matchRasterMask(binarise(gray, width, height), width, height, options);
}

/**
 * Same measurement for an image a document or a scanner already carries: those
 * bytes arrive encoded (PNG, JPEG, ...) and only get decoded to be measured.
 * Nothing here ever ENCODES -- a caller that renders a page keeps the pixels.
 */
export async function matchImageToVector(imageBytes, options = {}) {
  return matchPixelsToVector(await decodeImageRgba(imageBytes), options);
}

/**
 * Render exactly one suspect PDF region and hand back its RGBA pixels. `bbox`
 * uses PDF.js viewport coordinates (page points, origin at the top left) and
 * may come from PDF.js text geometry, Tesseract, or extraction-line layout.
 */
export async function renderPdfRegionRgba(source, pageNumber, bbox, {
  scale = 4,
  pad = 4,
} = {}) {
  const doc = await openPdf(Buffer.isBuffer(source) ? source : Buffer.from(source));
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) throw new RangeError(`Invalid PDF page ${pageNumber}`);
    const page = await doc.getPage(pageNumber);
    try {
      const rendered = await renderPageCanvas(page, scale);
      return cropCanvasRgba(rendered.canvas, {
        x0: Math.min(bbox.x0, bbox.x1),
        y0: Math.min(bbox.y0, bbox.y1),
        x1: Math.max(bbox.x0, bbox.x1),
        y1: Math.max(bbox.y0, bbox.y1),
      }, { scale, pad });
    } finally {
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}

export async function matchPdfRegionToVector(source, pageNumber, bbox, options = {}) {
  const crop = await renderPdfRegionRgba(source, pageNumber, bbox, options);
  // The pixel buffer stays out of the result: a caller asked for the label.
  return { ...matchPixelsToVector(crop, options), crop: { width: crop.width, height: crop.height } };
}

/**
 * Replace one scanner/OCR-located text range only when the pixels of that
 * region have an unambiguous labelled-SVG match. A refusal leaves the original
 * text intact. `image` is the region as bytes the source already carries.
 */
export async function repairTextRegionWithVector(text, {
  start,
  end,
  image,
  candidates,
}, options = {}) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) {
    throw new RangeError("invalid vector-repair text range");
  }
  const match = await matchImageToVector(image, { ...options, candidates });
  if (!match.accepted) return { text, changed: false, match };
  return {
    text: `${text.slice(0, start)}${match.text}${text.slice(end)}`,
    changed: true,
    match,
  };
}

function isMyanmarOutput(text) {
  return Boolean(text) && [...text].some((ch) => {
    const cp = ch.codePointAt(0);
    return cp >= 0x1000 && cp <= 0x109f;
  });
}

/**
 * Build a document-specific legacy layout from the pixels the PDF actually
 * draws. PDF.js supplies character boxes only to locate a suspect region. That
 * region's rendered pixels are measured against labelled SVG entries; the
 * embedded font program and the repository font collection are never opened.
 *
 * Work is deliberately limited to source codes on which registered layouts
 * disagree. Agreement needs no vote. A low-confidence/ambiguous crop abstains,
 * then the strongest registered layout supplies that slot. The returned table
 * is subsequently scored beside the registered layouts by pipeline.mjs, so a
 * weak auto-build cannot bypass the existing Burmese quality floor.
 */
export async function buildVectorLegacyLayout(source, layouts, {
  probePages = 6,
  occurrencesPerCode = 2,
  scale = 5,
  minDecisions = 4,
  objects = null,
  log = () => {},
} = {}) {
  /* Ledger for the whole vote, filled by this function and emitted ONCE at
     whichever exit is taken. This routine has FOUR ways to return null and
     the caller cannot tell them apart, which is why a bad auto-layout can
     only be investigated by resubmitting the file. `outcome` names it. */
  const L = {
    layouts: 0, codes: 0, disputed: 0, cropsMatched: 0, cropsAccepted: 0, cropsAliased: 0,
    decisions: 0, winnerVotes: 0, outcome: 'built',
  };
  const done = (outcome, extra = {}) => {
    emitEvent('vote', { ...L, ...extra, outcome });
    return null;
  };

  const layoutEntries = [...layouts];
  L.layouts = layoutEntries.length;
  if (layoutEntries.length < 2) return done('too-few-layouts');
  const disputed = new Map();
  const allCodes = new Set(layoutEntries.flatMap(([, table]) => [...table.keys()]));
  L.codes = allCodes.size;
  for (const code of allCodes) {
    const values = [...new Set(layoutEntries.map(([, table]) => table.get(code)).filter(isMyanmarOutput))];
    if (values.length > 1) disputed.set(code, values);
  }
  L.disputed = disputed.size;
  // Agreement needs no vote: only the disputed codes cost a rendered crop.
  if (!disputed.size) return done('no-dispute');

  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  // The document's legacy-layout font faces (/BaseFont + descriptor metrics).
  // A PDF.js font id never exposes its /BaseFont, but it does expose the
  // same ascent/descent, so the pixel-identified face can be resolved back to
  // the real name the decode-time font gate is keyed on.
  const objs = objects || parsePdfObjects(bytes);
  const faces = legacyFontFaces(objs, getStream, parseToUnicodeStream);
  const doc = await openPdf(bytes);
  const samples = new Map();
  const fontText = new Map(); // PDF.js fontName -> its decoded text, for the language check
  const fontMetrics = new Map(); // PDF.js fontName -> { ascent, descent }
  let loggedEnglish = "";
  const addSample = (fontName, code, sample) => {
    const key = `${fontName}\u0000${code}`;
    const list = samples.get(key) || [];
    if (list.length < occurrencesPerCode) {
      list.push(sample);
      samples.set(key, list);
    }
  };

  try {
    const count = Math.min(doc.numPages, probePages);
    for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
      const page = await doc.getPage(pageIndex + 1);
      try {
        const chars = await pageTextCharacters(page);
        for (const c of chars) {
          fontText.set(c.fontName, (fontText.get(c.fontName) || "") + c.text);
          if (c.fontAscent !== null && c.fontAscent !== undefined && !fontMetrics.has(c.fontName)) {
            fontMetrics.set(c.fontName, { ascent: c.fontAscent, descent: c.fontDescent });
          }
        }
        // ONE-SIDED ENGLISH CHECK, before any pixel work: a font whose ASCII
        // reads as valid English is a real Latin face, never the Myanmar
        // keyboard face -- its ink cannot vote and must not be sampled.
        // ("jrefm okdrf" salad stays a candidate; the pixels decide.)
        const englishFaces = new Set();
        for (const [fontName, text] of fontText) {
          if (englishLikeness(text).verdict === "english") englishFaces.add(fontName);
        }
        if (englishFaces.size) {
          const key = [...englishFaces].sort().join(",");
          if (key !== loggedEnglish) {
            loggedEnglish = key;
            log(`[i] English face${englishFaces.size > 1 ? "s" : ""} excluded from the Myanmar vote: `
              + `${[...englishFaces].map((f) => JSON.stringify(f)).join(", ")}`);
          }
        }
        const pageSamples = chars.filter(({ fontName, code }) => {
          if (englishFaces.has(fontName)) return false;
          if (!disputed.has(code)) return false;
          const key = `${fontName}\u0000${code}`;
          return (samples.get(key)?.length || 0) < occurrencesPerCode;
        });
        if (!pageSamples.length) continue;

        const rendered = await renderPageCanvas(page, scale);
        for (const sample of pageSamples) {
          const b = sample.bbox;
          const lineHeight = Math.max(1, b.y1 - b.y0);
          // Zero-advance stack/mark glyphs have almost zero-width boxes. Their
          // ink projects beyond the cursor, so widen those crops more than an
          // ordinary base glyph.
          const pad = Math.max(1.25, lineHeight * ((b.x1 - b.x0) < lineHeight * 0.12 ? 0.34 : 0.08));
          const crop = cropCanvasRgba(rendered.canvas, b, { scale, pad });
          addSample(sample.fontName, sample.code, matchPixelsToVector(crop, {
            candidates: disputed.get(sample.code),
            maxDistance: 0.12,
            minMargin: 0.012,
          }));
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await doc.destroy();
  }

  // Resolve repeated crops per (font, source code), then find the font that
  // yielded the most confident Myanmar matches. Real Latin fonts naturally
  // abstain because their rendered letters do not resemble either SVG shape.
  const byFont = new Map();
  for (const [key, results] of samples) {
    const split = key.lastIndexOf("\u0000");
    const fontName = key.slice(0, split);
    const code = Number(key.slice(split + 1));
    const accepted = results.filter((result) => result.accepted);
    L.cropsMatched += results.length;
    L.cropsAccepted += accepted.length;
    // Refused because the witness crowd cannot place the pair -- counted here so
    // a build that lost slots to the veto is visibly a veto, not a regression.
    for (const result of results) {
      if (!result.accepted && /cross-font alias/u.test(String(result.reason ?? ""))) L.cropsAliased += 1;
    }
    if (!accepted.length) continue;
    const tally = new Map();
    for (const result of accepted) {
      const item = tally.get(result.text) || { count: 0, best: result };
      item.count += 1;
      if (result.distance < item.best.distance) item.best = result;
      tally.set(result.text, item);
    }
    const ranked = [...tally].sort((a, b) => (b[1].count - a[1].count) || (a[1].best.distance - b[1].best.distance));
    if (ranked.length > 1 && ranked[0][1].count === ranked[1][1].count) continue;
    const font = byFont.get(fontName) || { decisions: new Map(), confidence: new Map(), distance: 0 };
    font.decisions.set(code, ranked[0][0]);
    font.confidence.set(code, {
      distance: ranked[0][1].best.distance,
      margin: ranked[0][1].best.margin,
      samples: ranked[0][1].count,
    });
    font.distance += ranked[0][1].best.distance;
    byFont.set(fontName, font);
  }

  if (L.cropsAliased) {
    log(`[i] SVG auto-layout refused ${L.cropsAliased} slot(s) as cross-font alias: some face in the crowd draws the rival letter alike, so shape alone cannot decide`);
  }

  // A face that only turned English once enough text accumulated must not
  // keep votes it gathered before the verdict settled.
  const englishFinal = new Set(
    [...byFont.keys()].filter((name) => englishLikeness(fontText.get(name) || "").verdict === "english"));
  const fonts = [...byFont]
    .filter(([name]) => !englishFinal.has(name))
    .filter(([, item]) => item.decisions.size >= minDecisions)
    .sort((a, b) => (b[1].decisions.size - a[1].decisions.size) || (a[1].distance - b[1].distance));
  if (!fonts.length) {
    log(englishFinal.size
      ? "[i] SVG auto-layout abstained: every candidate face reads as English (no Myanmar keyboard face)"
      : "[i] SVG auto-layout abstained: too few unambiguous pixel crop matches");
    return done(englishFinal.size ? 'abstained-all-english' : 'abstained-too-few-matches');
  }
  const [fontName, evidence] = fonts[0];

  // Let the vector decisions vote which complete registered layout supplies
  // unresolved slots. Scanner-local repairs may later replace a disputed slot.
  const layoutVotes = layoutEntries.map(([name, table]) => {
    let votes = 0;
    for (const [code, text] of evidence.decisions) if (table.get(code) === text) votes += 1;
    return { name, table, votes };
  }).sort((a, b) => b.votes - a.votes);
  L.decisions = evidence.decisions.size;
  L.winnerVotes = layoutVotes[0]?.votes ?? 0;
  if (!layoutVotes.length || layoutVotes[0].votes === 0) return done('zero-votes');
  const table = new Map(layoutVotes[0].table);
  // A single isolated-glyph vote is not allowed to overturn a complete known
  // layout: connected Myanmar ink can leak across a character quad. Vector
  // evidence chooses the base layout and fills only absent slots. Actual
  // contradictory slots are resolved later at scanner-flagged regions, where
  // the whole cluster/line crop supplies the missing context.
  for (const [code, text] of evidence.decisions) {
    if (!table.has(code)) table.set(code, text);
  }
  const baseName = layoutVotes[0].name;
  // Resolve the pixel-identified face back to real /BaseFont names: PDF.js
  // hides the name, but its ascent/descent comes straight from the same font
  // descriptor. These names EARNED the pixel evidence and join the layout
  // name as keys in the decode-time font gate.
  const winnerMetrics = fontMetrics.get(fontName) || null;
  const sourceBaseFonts = winnerMetrics
    ? [...new Set(faces
        .filter((face) => Math.abs(face.ascent - winnerMetrics.ascent) <= 0.003
          && Math.abs(face.descent - winnerMetrics.descent) <= 0.003)
        .map((face) => face.baseFont))]
    : [];
  const displayName = baseName.toLowerCase() === "wininnwa"
    ? "WinInnwa"
    : baseName.charAt(0).toUpperCase() + baseName.slice(1);
  emitEvent('vote', {
    ...L,
    decisions: evidence.decisions.size,
    winnerVotes: layoutVotes[0].votes,
    outcome: 'built',
    baseLayout: baseName,
    tableSize: table.size,
  });

  const result = {
    name: `vector:${displayName}`,
    table,
    // The parser's font matcher tolerates six-letter subset prefixes
    // (EAAAAA+WinInnwa); sourceBaseFonts extends the gate with the actual
    // renamed faces whose pixels earned the layout.
    fontName: baseName,
    sourceFont: fontName,
    sourceBaseFonts,
    decisions: evidence.decisions,
    confidence: evidence.confidence,
    matched: evidence.decisions.size,
    baseLayout: layoutVotes[0].name,
    votes: layoutVotes.map(({ name, votes }) => [name, votes]),
  };
  log(`[+] SVG auto-layout built from ${result.matched} pixel crop(s) in PDF.js font ${JSON.stringify(fontName)}; `
    + `base ${JSON.stringify(result.baseLayout)}`
    + (sourceBaseFonts.length ? `; resolves to ${sourceBaseFonts.map((f) => JSON.stringify(f)).join(", ")}` : ""));
  return result;
}
