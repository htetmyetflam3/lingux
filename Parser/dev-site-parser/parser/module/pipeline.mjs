/**
 * Port of pipeline.py — the shared service layer.
 *
 * This is where "same result" is actually decided, because the decode source is
 * chosen by running the Markov model over real probe pages:
 *
 *   pass 1  decode the first 20 pages with IDENTITY (content-stream code == code
 *           point). If ANY probe page scores as Myanmar, every page is decoded
 *           that way and no font or CMap is opened at all.
 *   pass 2  otherwise the embedded font cmaps are merged (reversed to gid->unicode,
 *           first font wins) and /ToUnicode maps are collected (blanked
 *           copy-protection decoys filtered, sidecar cipher map merged with
 *           setdefault so the document's own entries win). Each candidate is then
 *           RE-EXTRACTED through the model on the probe pages to see if it decodes
 *           Myanmar; a cmap that decodes wins as a CmapIdentityMap, and
 *           /ToUnicode NEVER fills its gaps. With no detector at all, the first
 *           non-empty map wins without verification — the same order matters.
 *
 * Memory shape, mirroring the Python rather than "improving" it:
 *   - the whole PDF buffer plus a Map of zero-copy object views is live for the
 *     entire run (Python holds raw + one stripped copy per object; Node holds raw
 *     and views, so ~1x instead of ~2x — behaviour-identical, cheaper).
 *   - pages are produced ONE AT A TIME by a generator; only the final text (and,
 *     in layout mode, the lines) is kept per page, because renderers and the API
 *     job both need the whole page list.
 */
import fs from "node:fs";
import path from "node:path";

import { findModelPath } from "./paths.mjs";
import { ZawgyiDetector } from "./detector.mjs";
import { Rabbit } from "./rabbit.mjs";
import { cleanupText, orderText } from "./normalize.mjs";
import { extractDocxParagraphs, validateDocxArchive } from "./docx-extract.mjs";
import { extractDocxParagraphsExternal } from "./docx-external.mjs";
import { scoreText } from "./mm-score.mjs";
import { MAX_PAGES, MAX_TEXT_CHARS } from "./resource-limits.mjs";
import {
  parsePdfObjects, findFontStreams, findToUnicodeMaps, ARLARWADE_AYAR_MAP,
  loadSidecarMap, pickEmbeddedFont, getStream, parseTtfCmap, findRootPages, collectPages,
  extractPageLines, pageHasImages, getPageMediabox, parseToUnicodeStream,
} from "./pdf-extract.mjs";
import {
  CmapIdentityMap, LegacyAyarMap, DocumentDecoding, LEGACY_CODE_PAGES,
  detectLegacyLayoutFonts,
} from "./pdf-fonts.mjs";
import { writeDocxLayout, writePdf } from "./render.mjs";
import { pyTruthy, pyRound, RuntimeError, splitExt, baseName } from "./pylib.mjs";

// Pages probed with direct Identity-H decoding before deciding whether the
// document needs the ToUnicode / embedded-font-cmap fallback path.
export const DETECT_PROBE_PAGES = 20;

/**
 * Exported for the parity harness (.bin/praser-trace.mjs). In Python these are
 * private (_norm_category / _safe_prob / _count_diff_lines); the JS port keeps the
 * same behaviour, and exporting them is what lets the test compare a trace without
 * reimplementing any of it.
 */
export function normCategory(category) {
  const cat = String(category).toUpperCase();
  return cat === "OTHER" ? "UNKNOWN" : cat;
}

/** JSON-safe probability: the detector returns -inf for UNKNOWN pages, which
 *  would serialise as -Infinity (invalid strict JSON for browsers). */
export function safeProb(prob) {
  return Number.isFinite(prob) ? prob : 0.0;
}

const isMyanmarCategory = (category) => {
  const cat = normCategory(category);
  return cat === "ZAWGYI" || cat === "UNICODE";
};

// A layout this document actually uses scores ~0.97; one it does not scores
// ~0.58 (measured on a 445-page legacy grammar, correct table vs wrong table).
// The floor sits between them, well clear of both.
export const LEGACY_QUALITY_FLOOR = 0.85;

// Pages sampled when ranking layouts. Enough Myanmar to be decisive, few
// enough that trying every registered layout stays cheap.
const CODE_PAGE_PROBE_PAGES = 6;

/** _choose_code_page(): pick the legacy layout that decodes this document
 * best. A legacy code page belongs to a keyboard layout, not to a typeface,
 * and nothing in the PDF records which one was used — the font names lie.
 * So every registered layout is tried on a sample of pages and scored on
 * whether the result reads like Burmese (marks attached to bases, in a
 * possible order). The winner is returned with its score, so the caller can
 * warn when even the best one does not fit.
 *
 * Returns [table, name, score, ranking]. */
function chooseCodePage(objects, allPages, legacyMap) {
  const ranking = [];
  for (const [name, table] of LEGACY_CODE_PAGES) {
    const strategy = new DocumentDecoding("legacy", legacyMap, table);
    const chunks = [];
    for (const [pnum, pgen] of allPages.slice(0, CODE_PAGE_PROBE_PAGES)) {
      let plines;
      try {
        [plines] = extractPageLines(objects, pnum, pgen, strategy);
      } catch {
        continue;
      }
      chunks.push(plines.map((x) => x[3]).join("\n"));
    }
    const sample = chunks.join("\n");
    // Score what the pipeline actually delivers. Reorder-by-priority is no
    // longer done at parse time -- it runs on every page later, in
    // orderText -- so a layout has to be judged on its ORDERED text or every
    // candidate is penalised for a typing order that is about to be fixed.
    // Imposter cleanup is deliberately not applied here: it is the Unicode
    // branch's step and the category is not known yet.
    const result = scoreText(orderText(sample));
    // A sample with almost no marks cannot be judged; treat it as unfit
    // rather than letting a near-empty decode win by default.
    ranking.push([name, result.marks >= 50 ? result.score : 0.0]);
  }
  ranking.sort((a, b) => b[1] - a[1]);
  const [bestName, bestScore] = ranking[0];
  return [LEGACY_CODE_PAGES.get(bestName), bestName, bestScore, ranking];
}

export function loadDetector() {
  const modelPath = findModelPath();
  if (!fs.existsSync(modelPath) || !fs.statSync(modelPath).isFile()) {
    throw new RuntimeError(
      `Zawgyi model not found (searched: ${modelPath}). `
      + "Expected zawgyiUnicodeModel.dat under module/model/ (or set ZAWGYI_MODEL).",
    );
  }
  return new ZawgyiDetector(modelPath);
}

/**
 * stream_pdf_pages(): (metadata, npages, pageIterator).
 * `source` is a path or a Buffer of the whole file.
 */
export function streamPdfPages(source, detector = null, log = () => {}) {
  const raw = Buffer.isBuffer(source) || source instanceof Uint8Array
    ? (Buffer.isBuffer(source) ? source : Buffer.from(source))
    : fs.readFileSync(source);
  log(`[+] PDF size: ${raw.length.toLocaleString("en-US")} bytes`);

  const objects = parsePdfObjects(raw);
  log(`[+] Objects found: ${objects.size}`);
  const metadata = {}; // the final pipeline never scans PDF metadata

  const pagesObj = findRootPages(objects);
  if (pagesObj === null || pagesObj === undefined) {
    throw new RuntimeError("No page tree found in the PDF.");
  }
  const allPages = collectPages(objects, pagesObj);
  const npages = allPages.length;
  if (npages > MAX_PAGES) {
    throw new RuntimeError(`PDF exceeds the ${MAX_PAGES} page cap`);
  }
  log(`[+] Total pages: ${npages}`);

  const page = (idx, codeToUni) => {
    const [pnum, pgen] = allPages[idx];
    // A page carrying an /Image XObject used to be emitted EMPTY, on the
    // assumption that it was a scan. That is the wrong test: a page with a
    // logo, a rule, or a diagram alongside real text is completely ordinary,
    // and this discarded every word on it. Two of the sample documents are
    // HTML-to-PDF conversions where EVERY page carries an image, so both
    // came out entirely blank despite decoding perfectly. Extract the text
    // either way and keep the flag for the DOCX writer; a genuine scan
    // simply yields no text and is unaffected.
    const hasImg = pageHasImages(objects, pnum, pgen);
    const [lines, w, h] = extractPageLines(objects, pnum, pgen, codeToUni);
    return {
      idx,
      lines,
      wh: [w, h],
      text: lines.map((l) => l[3]).join("\n"),
      hasImg,
    };
  };

  function* generate() {
    // --- Pass 1: model-first direct (Identity-H) decoding -----------------
    // The codes ARE the code points; simple fonts on the same page still go
    // through their own declared encoding, so Latin resources are not read
    // as Myanmar code points.
    const direct = new DocumentDecoding("identity");
    if (detector !== null) {
      const probeN = Math.min(DETECT_PROBE_PAGES, npages);
      const probe = [];
      for (let idx = 0; idx < probeN; idx += 1) probe.push(page(idx, direct));
      let hasMyanmar = false;
      for (const p of probe) {
        if (isMyanmarCategory(detector.detect(p.text)[0])) { hasMyanmar = true; break; }
      }
      if (hasMyanmar) {
        log("[+] Identity-H direct decode — no font/CMap lookup needed");
        for (const p of probe) yield p;
        for (let idx = probeN; idx < npages; idx += 1) {
          yield page(idx, direct);
          if ((idx + 1) % 500 === 0) log(`    ... extracted ${idx + 1}/${npages} pages`);
        }
        return;
      }
      log("[i] No Myanmar found via direct decode; trying ToUnicode/font cmap");
    }

    // --- Pass 2: truth-first decoding sources -----------------------------
    // (a) Embedded font cmap, reversed (the original v1 "peek the font"
    //     method). For these books the font cmap is the GLYPH TRUTH; the
    //     /ToUnicode streams are copy-protection decoys (blanked or with
    //     scrubbed codepoints) and must never win while a cmap decodes.
    // (b) ToUnicode CMaps (+ cross-volume sidecar fill) — fallback for
    //     CFF/OpenType fonts with no usable cmap.
    // Each source is verified with the Markov model on probe pages.
    //
    // None of them is a page-wide decoder any more: a source is the
    // document-level FALLBACK that the per-resource decoders in pdf-fonts
    // consult for the symbolic Myanmar faces. A font resource that declares
    // a real encoding (/WinAnsiEncoding, /MacRomanEncoding, an /Encoding
    // dict) never reaches it, which is what stops Latin character codes from
    // being read as Myanmar glyph ids.
    const probeN2 = Math.min(DETECT_PROBE_PAGES, npages);
    const decodesMyanmar = (strategy) => {
      for (let i = 0; i < probeN2; i += 1) {
        const [pnum, pgen] = allPages[i];
        const [plines] = extractPageLines(objects, pnum, pgen, strategy);
        const t = plines.map((x) => x[3]).join("\n");
        if (isMyanmarCategory(detector.detect(t)[0])) return true;
      }
      return false;
    };

    const cmapMap = new Map();
    let conflicts = 0;
    const fontRefs = findFontStreams(objects);
    if (pyTruthy(fontRefs)) {
      log(`[+] Embedded font-stream candidates: ${fontRefs.length}`);
      // Merge the cmap reversal of EVERY embedded font: the book subsets the same
      // base font per page batch, so glyph IDs are shared but each subset's cmap
      // covers only its own glyphs. The Myanmar-glyph font goes first and wins
      // any gid conflict. Each font resource still prefers the cmap of the font
      // program IT points at; this merge only fills what that cannot cover.
      // No log argument, exactly like the Python call: pick_embedded_font()'s own
      // "Chosen embedded font obj" line belongs to the API/debug path, and the
      // merged-cmap log below is what the pipeline prints.
      const [ffRef, ttf0, cmap0] = pickEmbeddedFont(objects, fontRefs);
      const ordered = [];
      if (ffRef) ordered.push(ffRef);
      for (const r of fontRefs) if (!(ffRef && r[0] === ffRef[0] && r[1] === ffRef[1])) ordered.push(r);
      let used = 0;
      for (const ref of ordered) {
        let ttf;
        let cmap;
        if (ffRef && ref[0] === ffRef[0] && ref[1] === ffRef[1]) {
          ttf = ttf0;
          cmap = cmap0;
        } else {
          ttf = getStream(objects, ref[0], ref[1]);
          cmap = pyTruthy(ttf) ? parseTtfCmap(ttf) : new Map();
        }
        if (!pyTruthy(cmap)) continue;
        used += 1;
        for (const [uni, gid] of cmap) {
          if (!gid) continue;
          if (cmapMap.has(gid)) {
            if (cmapMap.get(gid) !== uni) conflicts += 1;
            continue;
          }
          cmapMap.set(gid, uni);
        }
      }
      log(`[+] Merged font cmap entries: ${cmapMap.size} from ${used} font stream(s)`
        + (conflicts ? `; ${conflicts} gid conflict(s) (first font wins)` : ""));
    }

    // Arlarwade subsets are old Ayar-compatible fonts. Their cmap maps the PDF
    // character code to a RENUMBERED GLYPH ID, so reversing it (the generic
    // cmap path above) cannot recover the legacy code. The stable character-
    // code table is the authoritative path for this family and is checked
    // before the generic glyph-id fallback. Identification is structural, not
    // by name: a simple font with no /Encoding whose /ToUnicode returns
    // non-Myanmar characters is an ASCII-slot legacy face, whatever /BaseFont
    // claims.
    const legacyFonts = detectLegacyLayoutFonts(objects, getStream, parseToUnicodeStream);
    let legacyMap = legacyFonts.length ? new LegacyAyarMap(ARLARWADE_AYAR_MAP) : new Map();
    let legacyPage = null;
    if (legacyMap.size) {
      log(`[+] Legacy-layout fonts: ${legacyFonts.length}`);
      const [table, name, quality, ranking] = chooseCodePage(objects, allPages, legacyMap);
      for (const [nm, sc] of ranking) {
        log(`    layout ${JSON.stringify(nm)}: ${sc.toFixed(3)}${nm === name ? "  <- chosen" : ""}`);
      }
      legacyPage = table;
      if (quality < LEGACY_QUALITY_FLOOR) {
        // No registered layout fits, so do not decode as legacy at all. The
        // legacy strategy exists for faces whose /ToUnicode is a copy-
        // protection decoy, and it distrusts those maps document-wide.
        // Applying it to a document we cannot actually decode throws away
        // /ToUnicode maps that may be perfectly genuine -- and because
        // legacy subsets number their glyphs from 0x01, the undecoded bytes
        // are then dropped as control characters and the page comes out
        // EMPTY. Falling back costs nothing when the layout is unknown and
        // recovers the whole document when the maps are real.
        log(`[!] No registered legacy layout fits this document `
          + `(best ${JSON.stringify(name)} scores ${quality.toFixed(3)}, `
          + `expected >= ${LEGACY_QUALITY_FLOOR.toFixed(2)}). Falling back to `
          + `each font's own /ToUnicode. If the Myanmar text is wrong, `
          + `add this layout's code page to LEGACY_CODE_PAGES in pdf-fonts.mjs.`);
        legacyMap = new Map();
        legacyPage = null;
      }
    }

    // Document-wide ToUnicode merge (+ the cross-volume sidecar cipher).
    // Fonts consult their OWN /ToUnicode first; this merge is only the
    // last-resort fill for the codes their own map does not cover.
    const tuMap = findToUnicodeMaps(objects);
    const ownTu = tuMap.size;
    const sidecar = loadSidecarMap();
    for (const [code, uni] of sidecar) if (!tuMap.has(code)) tuMap.set(code, uni);
    if (tuMap.size) {
      log("[+] ToUnicode mappings: " + ownTu
        + (sidecar.size ? ` (+${tuMap.size - ownTu} from sidecar cipher map)` : ""));
    }

    let decoding = null;
    if (detector !== null) {
      if (legacyMap.size && decodesMyanmar(new DocumentDecoding("legacy", legacyMap, legacyPage))) {
        decoding = new DocumentDecoding("legacy", legacyMap, legacyPage);
        log("[+] Decoding via Arlarwade/Ayar legacy character map");
      } else if (pyTruthy(cmapMap) && decodesMyanmar(new DocumentDecoding("cmap", new CmapIdentityMap(cmapMap)))) {
        // cmap is the glyph truth; CmapIdentityMap adds the two decode truths:
        // 0x0000 = tab/space, unmapped valid code points = exact-Unicode fonts.
        // ToUnicode NEVER fills gaps here — it is the copy-protection decoy.
        decoding = new DocumentDecoding("cmap", new CmapIdentityMap(cmapMap));
        log("[+] Decoding via embedded font cmap (glyph truth) "
          + "+ identity fallback for exact-Unicode fonts");
      } else if (pyTruthy(tuMap) && decodesMyanmar(new DocumentDecoding("tounicode", tuMap))) {
        decoding = new DocumentDecoding("tounicode", tuMap);
        log("[+] Decoding via ToUnicode/sidecar map");
      }
    }
    if (decoding === null) {
      if (legacyMap.size) decoding = new DocumentDecoding("legacy", legacyMap, legacyPage);
      else if (pyTruthy(cmapMap)) decoding = new DocumentDecoding("cmap", cmapMap);
      else if (pyTruthy(tuMap)) decoding = new DocumentDecoding("tounicode", tuMap);
      else decoding = new DocumentDecoding("none");
    }

    if (decoding.kind === "none") {
      log("[!] No font cmap and no ToUnicode map; "
        + "unmapped codes will appear as [XXXX] placeholders");
    }

    for (let idx = 0; idx < npages; idx += 1) {
      yield page(idx, decoding);
      if ((idx + 1) % 500 === 0) log(`    ... extracted ${idx + 1}/${npages} pages`);
    }
  }

  return [metadata, npages, generate()];
}

/**
 * _cleanup_for(): imposter cleanup for a page of category `cat`, or `null`.
 *
 * IMPOSTER replacement is the UNICODE extraction branch's step only: a ZAWGYI page
 * is Rabbit's output and its Zawgyi code points have already been converted, so
 * re-reading them as imposters would edit a conversion this module does not own.
 * UNKNOWN has no conversion to trust either way. Ordering is NOT decided here —
 * `orderText` has already run on every page, so `text` arrives ordered and the only
 * difference this can produce is an imposter replacement (plus the reorder its
 * expansion needs).
 */
export function cleanupFor(cat, text) {
  return cat === "UNICODE" ? cleanupText(text) : null;
}

/**
 * _convert_line(): the same per-page transform applied to one extracted line
 * (layout mode). Mark ordering is not a toggle: every line gets `orderText`,
 * whatever the category; imposter cleanup is the UNICODE + applyCleanup branch
 * alone.
 */
function convertLine(t, cat, applyCleanup) {
  if (cat === "ZAWGYI") return orderText(Rabbit.zg2uni(t)); // ordered, never imposter-fixed
  if (cat === "UNICODE" && applyCleanup) return cleanupText(t);
  return orderText(t);
}

function convLines(lines, cat, applyCleanup) {
  return lines.map(([x, y, size, t]) => [x, y, size, convertLine(t, cat, applyCleanup)]);
}

/** Number of lines the cleanup changed, without building change records. */
export function countDiffLines(base, clean) {
  const bl = base.split("\n");
  const cl = clean.split("\n");
  const n = Math.max(bl.length, cl.length);
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    if ((i < bl.length ? bl[i] : "") !== (i < cl.length ? cl[i] : "")) count += 1;
  }
  return count;
}

/**
 * Transform one already-extracted page into the normal pipeline report.  Both
 * the recovery parser and the PDF.js Unicode parser use this exact per-page
 * conversion, detection, cleanup, and layout handling.
 */
export function processPageRecord(pg, detector, applyCleanup, log = () => {}, wantLayout = false) {
  const idx = pg.idx;
  const raw = pg.text;
  const [category, prob] = detector.detect(raw);
  const cat = normCategory(category);

  if (cat === "UNKNOWN") {
    // Mark ordering is not a toggle and not a branch: every page gets it, Zawgyi
    // after Rabbit, Unicode as extracted, Unknown too (where it is a no-op —
    // nothing to order outside Myanmar).
    const base = orderText(raw);
    const rep = {
      page: idx + 1, category: cat, prob: safeProb(prob), text: base, nChanges: 0,
    };
    if (wantLayout) {
      rep.lines = convLines(pg.lines, null, null);
      rep.wh = pg.wh;
      rep.hasImg = pg.hasImg;
    }
    log(`    Page ${idx + 1}: UNKNOWN -> passed through`);
    return rep;
  }

  let base;
  if (cat === "ZAWGYI") {
    base = orderText(Rabbit.zg2uni(raw));
    log(`    Page ${idx + 1}: ZAWGYI (p=${fmtProb(prob)}) -> converted`);
  } else {
    base = orderText(raw);
    log(`    Page ${idx + 1}: UNICODE (p=${fmtProb(prob)}) -> kept`);
  }

  const clean = cleanupFor(cat, base);
  const nChanges = clean === null || clean === base ? 0 : countDiffLines(base, clean);
  const text = applyCleanup && clean !== null ? clean : base;
  const rep = {
    page: idx + 1, category: cat, prob: safeProb(prob), text, nChanges,
  };
  if (wantLayout) {
    rep.lines = convLines(pg.lines, cat, applyCleanup);
    rep.wh = pg.wh;
    rep.hasImg = pg.hasImg;
  }
  return rep;
}

/**
 * process_pdf_stream(): single-pass streaming pipeline.
 * Returns (metadata, npages, reportIterator); each report keeps ONLY the final
 * text for its page (plus layout when wantLayout), which is what keeps memory
 * flat on a 7000-page book.
 */
export function processPdfStream(pdfSource, detector, applyCleanup, log = () => {}, wantLayout = false) {
  const [metadata, npages, pages] = streamPdfPages(pdfSource, detector, log);

  function* reports() {
    for (const pg of pages) {
      yield processPageRecord(pg, detector, applyCleanup, log, wantLayout);
    }
  }

  return [metadata, npages, reports()];
}

// f"{prob:.3f}" for a finite float; Python prints "-inf" for the -inf case.
function fmtProb(prob) {
  return Number.isFinite(prob) ? prob.toFixed(3) : (prob > 0 ? "inf" : "-inf");
}

/** collect_stream_results(): run the stream and keep final pages + counts. */
export function collectStreamResults(pdfSource, detector, applyCleanup, log = () => {}, wantLayout = false) {
  const [metadata, npages, reports] = processPdfStream(pdfSource, detector, applyCleanup, log, wantLayout);
  const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
  const pages = [];
  let totalChanges = 0;
  for (const rep of reports) {
    counts[rep.category] = (counts[rep.category] ?? 0) + 1;
    const out = {};
    if ("text" in rep) out.text = rep.text;
    if ("lines" in rep) out.lines = rep.lines;
    if ("wh" in rep) out.wh = rep.wh;
    if ("hasImg" in rep) out.hasImg = rep.hasImg;
    pages.push(out);
    totalChanges += rep.nChanges;
  }
  return [pages, counts, totalChanges, metadata, npages];
}

/** collect_changes(): the lines cleanup would change (preview data, plain text). */
export function collectChanges(reports) {
  const changes = [];
  for (const rep of reports) {
    if (rep.clean === null) continue;
    const baseLines = rep.base.split("\n");
    const cleanLines = rep.clean.split("\n");
    for (let li = 0; li < Math.max(baseLines.length, cleanLines.length); li += 1) {
      const bl = li < baseLines.length ? baseLines[li] : "";
      const cl = li < cleanLines.length ? cleanLines[li] : "";
      if (bl !== cl) {
        changes.push({
          id: `p${rep.page}-l${li + 1}`,
          page: rep.page,
          line: li + 1,
          category: rep.category,
          original: bl,
          suggested: cl,
        });
      }
    }
  }
  return changes;
}

/** build_content(): whole body as ONE plain text string (what a text-only caller eats). */
export function buildContent(job, applyCleanup = false, kind = null) {
  const k = (kind || job.kind || "pdf").toLowerCase();
  const sep = k === "docx" ? "\n" : "\n\n";
  const parts = [];
  const len = Math.min(job.pages.length, job.reports.length);
  for (let i = 0; i < len; i += 1) {
    const pg = job.pages[i];
    const rep = job.reports[i];
    parts.push(applyCleanup && rep.clean !== null && rep.clean !== undefined ? rep.clean : pg.text);
  }
  return parts.join(sep);
}

/** build_meta_header(): the banner render_texts() writes above the pages. */
export function buildMetaHeader(pdfPath, reports, counts, metadata) {
  const npages = reports === null || reports === undefined ? 0 : reports.length;
  const lines = [
    `# Source: ${pdfPath}`,
    `# Pages: ${npages}`,
    `# Detection: ${counts["ZAWGYI"] ?? 0} Zawgyi, ${counts["UNICODE"] ?? 0} Unicode, ${counts["UNKNOWN"] ?? 0} unknown`,
  ];
  for (const [k, v] of Object.entries(metadata || {})) lines.push(`# ${k}: ${v}`);
  lines.push("#".repeat(50));
  return lines.join("\n") + "\n\n";
}

/**
 * render_texts(): dispatch on the OUTPUT extension (.txt default; .docx/.pdf).
 * async because the .docx zip writer streams (Node's deflate is async) — the
 * bytes on disk match the Python's, which writes the same parts synchronously.
 */
export async function renderTexts(outPath, pages, counts, pdfPath) {
  let out = outPath;
  let ext = splitExt(outPath)[1];
  if (ext === "") {
    ext = ".txt";
    out += ".txt";
  }

  const texts = pages.map((p) => (typeof p === "string" ? p : p.text));
  const header = buildMetaHeader(pdfPath, texts, counts, {});

  if (ext === ".txt") {
    let body = header;
    for (let idx = 0; idx < texts.length; idx += 1) {
      body += `--- Page ${idx + 1} ---\n`;
      body += texts[idx] || "";
      body += "\n\n";
    }
    fs.writeFileSync(out, body, "utf8");
  } else if (ext === ".docx") {
    await writeDocxLayout(out, pages, pdfPath);
  } else if (ext === ".pdf") {
    writePdf(out, texts, {}, pdfPath, texts.length);
  } else {
    throw new Error(`Unsupported output extension: ${ext} (use .txt/.docx/.pdf)`);
  }
  return out;
}

/** process_pdf_bytes(): the batch job the API stores (reports AND layout kept). */
export function processPdfBytes(data, detector, filename = "upload.pdf", log = () => {}) {
  const source = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const [metadata, npages, reportsIter] = processPdfStream(source, detector, false, log, true);
  const reports = [];
  const pages = [];
  const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
  let textChars = 0;
  for (const rep of reportsIter) {
    const cat = rep.category;
    const base = rep.text; // converted (+ordered) base; cleanup not applied yet
    textChars += base.length;
    if (textChars > MAX_TEXT_CHARS) {
      throw new RuntimeError(`Extracted text exceeds the ${MAX_TEXT_CHARS} character cap`);
    }
    const clean = cleanupFor(cat, base); // UNICODE only
    reports.push({ page: rep.page, category: cat, prob: rep.prob, base, clean });
    pages.push({ text: base, lines: rep.lines, wh: rep.wh, hasImg: rep.hasImg });
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  const changes = collectChanges(reports);
  return {
    filename, kind: "pdf", reports, counts, metadata: {}, changes, pages, npages,
  };
}

// ── DOCX input — same pipeline, different container ─────────────────────────
// Paragraphs per detection/conversion chunk. 80 ~ one book page, which is the
// granularity the PDF path detects at.
export const DOCX_CHUNK_PARAGRAPHS = 80;

export function chunkParagraphs(paragraphs, perChunk = DOCX_CHUNK_PARAGRAPHS) {
  if (!paragraphs.length) return [""]; // Python returns [""] for an empty document
  const out = [];
  for (let i = 0; i < paragraphs.length; i += perChunk) {
    out.push(paragraphs.slice(i, i + perChunk).join("\n"));
  }
  return out;
}

/** Shared by every DOCX source (our own document.xml reader or mammoth) — the
 * only thing that differs between manager methods is where `paragraphs` came
 * from; detection, conversion, cleanup and chunking are identical either way. */
function buildDocxJob(paragraphs, filename, detector, log) {
  const reports = [];
  const pages = [];
  const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
  let textChars = 0;
  for (const paragraph of paragraphs) {
    textChars += paragraph.length;
    if (textChars > MAX_TEXT_CHARS) {
      throw new RuntimeError(`Extracted text exceeds the ${MAX_TEXT_CHARS} character cap`);
    }
  }
  const chunks = chunkParagraphs(paragraphs);
  if (chunks.length > MAX_PAGES) {
    throw new RuntimeError(`DOCX exceeds the ${MAX_PAGES} chunk cap`);
  }
  chunks.forEach((chunk, idx) => {
    const [category, prob] = detector.detect(chunk);
    const cat = normCategory(category);
    // Same rule as the PDF path: ordering on every chunk, whatever the category;
    // imposter cleanup only where the Unicode branch allows it.
    const base = cat === "ZAWGYI" ? orderText(Rabbit.zg2uni(chunk)) : orderText(chunk);
    const clean = cleanupFor(cat, base); // UNICODE only
    reports.push({ page: idx + 1, category: cat, prob: safeProb(prob), base, clean });
    pages.push({ text: base });
    counts[cat] = (counts[cat] ?? 0) + 1;
    log(`    Chunk ${idx + 1}: ${cat}`);
  });

  return {
    filename,
    kind: "docx",
    reports,
    counts,
    metadata: {},
    changes: collectChanges(reports),
    pages,
    paragraphs,
  };
}

export function processDocxBytes(data, detector, filename = "upload.docx", log = () => {}) {
  const paragraphs = extractDocxParagraphs(Buffer.isBuffer(data) ? data : Buffer.from(data));
  return buildDocxJob(paragraphs, filename, detector, log);
}

/** manager `method:"default"` for DOCX — same library (mammoth) the browser
 * ran, per API-PAYLOAD.md. mammoth.extractRawText() drops images on its own,
 * so this never needs a separate "skip images" step. */
export async function processDocxBytesExternal(data, detector, filename = "upload.docx", log = () => {}) {
  validateDocxArchive(Buffer.isBuffer(data) ? data : Buffer.from(data));
  const paragraphs = await extractDocxParagraphsExternal(data);
  return buildDocxJob(paragraphs, filename, detector, log);
}

/**
 * How good does manager `method:"default"` output have to look before it is
 * trusted? The frontend only sends `method:"default"` after its own detector
 * (the same two libraries, run in the browser) already found genuine Myanmar
 * Unicode letters — so this floor is a backend safety net, not the primary
 * decision. Below it, the text is not "answered Unicode" and PRASER's own
 * per-resource font decoder (`method:"manual"`) is who actually reads this file.
 *
 * PDF no longer has a distinct external reader to hold to this floor: the
 * recovery parser (processPdfBytes) already reads Zawgyi AND Unicode PDFs
 * correctly on its own (the detector runs AFTER extraction, inside
 * processPageRecord, purely to pick Rabbit-conversion vs pass-through), so a
 * Unicode PDF is already "auto handled" without a separate PDF.js pre-pass.
 * DOCX still has two real readers (mammoth vs PRASER's own docx-extract.mjs),
 * so the floor still gates that choice.
 */
export const EXTERNAL_UNICODE_QUALITY_FLOOR = 0.5;

function externalQualityOk(counts) {
  const total = (counts.ZAWGYI ?? 0) + (counts.UNICODE ?? 0) + (counts.UNKNOWN ?? 0);
  if (total === 0) return false;
  return (counts.UNICODE ?? 0) / total >= EXTERNAL_UNICODE_QUALITY_FLOOR;
}

/** manager `method:"default"`:
 *   PDF  -> the recovery/legacy font decoder is the only reader there is now
 *           (see EXTERNAL_UNICODE_QUALITY_FLOOR's doc comment for why no
 *           separate Unicode pre-pass is needed); identical to "manual".
 *   DOCX -> try mammoth, verify it actually read as Unicode Myanmar (or plain
 *           non-Myanmar text), and fall back to PRASER's own docx-extract.mjs
 *           when it did not. */
export async function processBytesDefault(data, kind, detector, filename = null, log = () => {}) {
  const k = (kind || "").toLowerCase();
  if (k === "pdf") return processPdfBytes(data, detector, filename || "upload.pdf", log);
  if (k === "docx") {
    const job = await processDocxBytesExternal(data, detector, filename || "upload.docx", log);
    if (externalQualityOk(job.counts)) return job;
    log("    default (mammoth) text failed the Unicode-readability check -> falling back to manual PRASER decode");
    return processDocxBytes(data, detector, filename || "upload.docx", log);
  }
  throw new Error(`Unsupported kind: ${JSON.stringify(kind)} (use 'pdf' or 'docx')`);
}

/** process_bytes(): one entry for both server-side formats — always the full
 * manual PRASER decode. Kept for callers that do not go through the manager's
 * {job, method, output} contract (e.g. the plain CLI). */
export function processBytes(data, kind, detector, filename = null, log = () => {}) {
  const k = (kind || "").toLowerCase();
  if (k === "pdf") return processPdfBytes(data, detector, filename || "upload.pdf", log);
  if (k === "docx") return processDocxBytes(data, detector, filename || "upload.docx", log);
  throw new Error(`Unsupported kind: ${JSON.stringify(kind)} (use 'pdf' or 'docx')`);
}

/**
 * processBytesForMethod(): the manager's dispatch across its three `method`
 * values — this is what the extractor worker actually calls once the manager
 * has routed a job to the extract lane.
 *
 *   "manual"  -> the full manual PRASER decode (per-resource font decoding,
 *                per-page legacy/Zawgyi/Unicode handling — unchanged, always
 *                correct, just possibly slower than the default path).
 *   "default" -> PDF: PRASER's own recovery decoder (there is no other PDF
 *                reader in this codebase); DOCX: mammoth first, verified,
 *                PRASER as the fallback.
 *   "null"    -> DOCX only ("no PDF path emits it" — API-PAYLOAD.md §4). Our
 *                own docx-extract.mjs never reads image relationships, so it
 *                already IS "skip the images, extract the text only".
 */
export async function processBytesForMethod(data, kind, method, detector, filename = null, log = () => {}) {
  const k = (kind || "").toLowerCase();
  const m = String(method || "default").toLowerCase();
  if (m === "manual") return processBytes(data, k, detector, filename, log);
  if (m === "null") {
    if (k !== "docx") {
      throw new Error(`method:"null" is DOCX-only (no PDF path emits it); got kind=${JSON.stringify(kind)}`);
    }
    return processBytes(data, k, detector, filename, log);
  }
  if (m === "default") return processBytesDefault(data, k, detector, filename, log);
  throw new Error(`Unsupported method: ${JSON.stringify(method)} (use "default"/"manual"/"null")`);
}

/** build_final_pages(): re-derive render pages from a stored job.
 *  Rabbit is never re-run — lines already hold converted base text. */
export function buildFinalPages(job, applyCleanup) {
  const out = [];
  const len = Math.min(job.pages.length, job.reports.length);
  for (let i = 0; i < len; i += 1) {
    const pg = job.pages[i];
    const rep = job.reports[i];
    if (!("lines" in pg)) {
      out.push({
        text: applyCleanup && rep.clean !== null && rep.clean !== undefined ? rep.clean : pg.text,
      });
      continue;
    }
    if (applyCleanup && rep.clean !== null && rep.clean !== undefined) {
      out.push({
        text: rep.clean,
        lines: pg.lines.map(([x, y, s, t]) => [x, y, s, cleanupText(t)]),
        wh: pg.wh,
        hasImg: pg.hasImg,
      });
    } else {
      out.push({ text: pg.text, lines: pg.lines, wh: pg.wh, hasImg: pg.hasImg });
    }
  }
  return out;
}

export { pyRound, baseName };
