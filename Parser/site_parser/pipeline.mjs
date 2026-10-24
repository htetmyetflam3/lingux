import { parseTtfCmap } from "./core/ttf-cmap.mjs";
import { renderPdfPagePng } from "./read/pdf-render.mjs";
import { note } from "./core/provenance.mjs";
import fs from "node:fs";
import path from "node:path";

import { findModelPath } from "./core/paths.mjs";
import { ZawgyiDetector } from "./text/detector.mjs";
import { decryptPdf, isEncryptedPdf } from "./read/decrypt.mjs";
import { Rabbit } from "./text/rabbit.mjs";
import { cleanupText, orderText } from "./text/normalize.mjs";
import { extractDocxParagraphs, extractDocxImages, validateDocxArchive } from "./read/docx-extract.mjs";
import { extractDocxParagraphsExternal } from "./read/docx-external.mjs";
import { scoreText } from "./text/mm-score.mjs";
import { MAX_PAGES, MAX_TEXT_CHARS } from "./core/limits.mjs";
import {
  parsePdfObjects, findFontStreams, findToUnicodeMaps, ARLARWADE_AYAR_MAP,
  loadSidecarMap, pickEmbeddedFont, getStream, findRootPages, collectPages,
  extractPageLines, pageHasImages, parseToUnicodeStream, extractMetadata,
} from "./read/pdf-extract.mjs";
import {
  CmapIdentityMap, LegacyAyarMap, DocumentDecoding, detectLegacyLayoutFonts,
  legacyFontFaces,
} from "./read/pdf-fonts.mjs";
import { LEGACY_CODE_PAGES, UNICODE_PATH } from "./codepage/registry.mjs";
import { writeDocxLayout, writePdf } from "./write/render.mjs";
import { chooseCodePage, prepareVectorLayout, LEGACY_QUALITY_FLOOR } from "./codepage/resolve.mjs";
import { buildVectorRepair } from "./codepage/vector-repair.mjs";

export { LEGACY_QUALITY_FLOOR };
import { pyTruthy, pyRound, RuntimeError, splitExt, baseName } from "./core/pylib.mjs";



export const DETECT_PROBE_PAGES = 20;

/** Pages walked to find glyph ids the cmap cannot name, before voting on them. */
const VECTOR_REPAIR_PROBE_PAGES = 12;

/**
 * Whether outline repair is worth attempting.
 *
 * Only a decoding that reads glyph ids from a font program can have a
 * glyph whose name is missing from that program; the legacy and
 * ToUnicode routes name every code they draw or none.
 */
function vectorRepairEnabled(decoding) {
  if (!decoding) return false;
  if (process.env.PRASER_VECTOR_REPAIR === "0") return false;
  return decoding.kind === "cmap";
}


export function normCategory(category) {
  const cat = String(category).toUpperCase();
  return cat === "OTHER" ? "UNKNOWN" : cat;
}


export function safeProb(prob) {
  return Number.isFinite(prob) ? prob : 0.0;
}

const isMyanmarCategory = (category) => {
  const cat = normCategory(category);
  return cat === "ZAWGYI" || cat === "UNICODE";
};





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


export function streamPdfPages(source, detector = null, log = () => {}, { vectorLayout = null, provenance = null } = {}) {
  const input = Buffer.isBuffer(source) || source instanceof Uint8Array
    ? (Buffer.isBuffer(source) ? source : Buffer.from(source))
    : fs.readFileSync(source);
  log(`[+] PDF size: ${input.length.toLocaleString("en-US")} bytes`);
  if (isEncryptedPdf(input)) {
    throw new RuntimeError(
      "This PDF is password-protected; decrypt it before extraction "
        + "(processBytesForMethod does this automatically).",
    );
  }
  const raw = input;

  const objects = parsePdfObjects(raw);
  log(`[+] Objects found: ${objects.size}`);
  /* extractMetadata() existed in read/pdf-extract.mjs and had never been
     called once: this was a hardcoded {} threaded through three return
     tuples into a header loop that iterated nothing. The /Info dictionary is
     what identifies a broken document later, so it is read for real now. */
  const metadata = extractMetadata(objects, raw);
  note(provenance, { metadata });

  const pagesObj = findRootPages(objects);
  if (pagesObj === null || pagesObj === undefined) {
    throw new RuntimeError("No page tree found in the PDF.");
  }
  const allPages = collectPages(objects, pagesObj);
  const npages = allPages.length;
  note(provenance, { pages: npages });
  if (npages > MAX_PAGES) {
    throw new RuntimeError(`PDF exceeds the ${MAX_PAGES} page cap`);
  }
  log(`[+] Total pages: ${npages}`);

  const page = (idx, codeToUni) => {
    const [pnum, pgen] = allPages[idx];
    
    
    
    
    
    
    
    
    const hasImg = pageHasImages(objects, pnum, pgen);
    const [lines, w, h] = extractPageLines(objects, pnum, pgen, codeToUni);
    return {
      idx,
      lines,
      wh: [w, h],
      text: lines.map((l) => l[3]).join("\n"),
      hasImg,
      /* How the glyph ids became characters. Carried to the per-page report
         because it settles a question the detector cannot: see
         processPageRecord. */
      decodeKind: codeToUni && typeof codeToUni === "object" ? codeToUni.kind : null,
    };
  };

  function* generate() {
    
    
    
    
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

    
    
    
    
    const legacyFonts = detectLegacyLayoutFonts(objects, getStream, parseToUnicodeStream);
    if (legacyFonts.length) {
      note(provenance, { fonts: legacyFontFaces(objects, getStream, parseToUnicodeStream) });
    }
    const tuMap = findToUnicodeMaps(objects);
    const ownTu = tuMap.size;
    const sidecar = loadSidecarMap();
    for (const [code, uni] of sidecar) if (!tuMap.has(code)) tuMap.set(code, uni);
    if (tuMap.size) {
      log("[+] ToUnicode mappings: " + ownTu
        + (sidecar.size ? ` (+${tuMap.size - ownTu} from sidecar cipher map)` : ""));
    }

    /* The document's own reading of itself, built before the codepage
       decision so it can COMPETE in it rather than only inherit the leavings.
       The embedded cmap is preferred over /ToUnicode for the same reason it
       is preferred below: it is the glyph list the font actually draws,
       whereas /ToUnicode is a claim the font makes about itself. */
    const unicodeStrategy = pyTruthy(cmapMap)
      ? new DocumentDecoding("cmap", new CmapIdentityMap(cmapMap))
      : (pyTruthy(tuMap) ? new DocumentDecoding("tounicode", tuMap) : null);
    if (unicodeStrategy) {
      log(`[+] Unicode path staged: ${unicodeStrategy.kind} (competing in the code page score)`);
    }
    let legacyMap = legacyFonts.length ? new LegacyAyarMap(ARLARWADE_AYAR_MAP) : new Map();
    let legacyPage = null;
    let legacyPageName = null;
    let legacyFontNames = null;
    /* THE TEXT PATH IS CHOSEN, NOT FALLEN INTO.

       Every path that can read this document stands as a named candidate
       and one score decides between them. The Unicode path is always one
       of them: it is a path on exactly the same footing as ayar and
       wininnwa, not a fallthrough that only gets tried once the legacy
       tables have already failed.

       That is what this used to be. The whole block sat behind
       `if (legacyMap.size)`, and legacyMap is only non-empty when the
       document carries legacy-layout fonts -- so on a plain Unicode PDF
       no path was ever chosen at all. The decode happened anyway, via a
       bare if/else chain further down that nobody logged and nothing
       scored. Reading the document as itself was the invisible default.

       The legacy tables only stand as candidates when there are legacy
       fonts to apply them to; scoring ayar and wininnwa against a
       document with no legacy font measures nothing. */
    if (legacyMap.size) log(`[+] Legacy-layout fonts: ${legacyFonts.length}`);
    {
      // Put the document-built vector layout first. When it intentionally
      // equals its selected registered base, stable sorting keeps the
      // raster->SVG result as the default while the normal text-quality score
      // still has the final say.
      const codePages = legacyMap.size
        ? (vectorLayout
            ? new Map([[vectorLayout.name, vectorLayout.table], ...LEGACY_CODE_PAGES])
            : LEGACY_CODE_PAGES)
        : new Map();
      const [table, name, quality, ranking] = chooseCodePage(objects, allPages, legacyMap, codePages, vectorLayout, unicodeStrategy);
      for (const [nm, sc] of ranking) {
        log(`    text path ${JSON.stringify(nm)}: ${sc.toFixed(3)}${nm === name ? "  <- chosen" : ""}`);
      }
      note(provenance, {
        codepage: {
          chosen: name,
          score: quality,
          floor: LEGACY_QUALITY_FLOOR,
          accepted: quality >= LEGACY_QUALITY_FLOOR,
          ranking: ranking.map(([nm, sc]) => [nm, sc]),
        },
      });
      /* Winning as "unicode" is a real result, not a fallback: the font's
         own maps outscored every foundry table, so no legacy table is
         applied and the decode below takes the cmap/ToUnicode branch. The
         score still has to clear the floor -- a document whose own maps
         score badly is not made better by them just being its own. */
      if (name === UNICODE_PATH) {
        log(`[+] Unicode path won the code page score (${quality.toFixed(3)}) `
          + `-- using the font's own maps, no legacy table`);
      }
      legacyPage = table;
      legacyPageName = name;
      legacyFontNames = vectorLayout && name === vectorLayout.name
        ? [vectorLayout.fontName, ...(vectorLayout.sourceBaseFonts || [])]
        : null;
      if (name === UNICODE_PATH) {
        /* Winning as "unicode" is a result, not a failure, and it must not
           be reported as one. The old message said "no registered legacy
           layout fits" and quoted the floor -- which fired even at 0.895
           against a floor of 0.85, telling the operator a threshold had
           been missed when it had been cleared. */
        log(`[+] Text path: unicode -- the document read as itself, from the `
          + `font's own ${unicodeStrategy ? unicodeStrategy.kind : "unicode"} `
          + `table (score ${quality.toFixed(3)}). No legacy table applied.`
          + (quality < LEGACY_QUALITY_FLOOR
            ? ` Below the ${LEGACY_QUALITY_FLOOR.toFixed(2)} floor, so this `
              + `text may still be poor -- but nothing else scored higher.`
            : ``));
        legacyMap = new Map();
        legacyPage = null;
        legacyPageName = null;
        legacyFontNames = null;
      } else if (quality < LEGACY_QUALITY_FLOOR) {
        log(`[!] No registered legacy layout fits this document `
          + `(best ${JSON.stringify(name)} scores ${quality.toFixed(3)}, `
          + `expected >= ${LEGACY_QUALITY_FLOOR.toFixed(2)}). Falling back to `
          + `each font's own /ToUnicode. If the Myanmar text is wrong, `
          + `add this document's code page to LEGACY_CODE_PAGES in `
          + `codepage/registry.mjs.`);
        legacyMap = new Map();
        legacyPage = null;
        legacyPageName = null;
        legacyFontNames = null;
      }
    }

    
    
    
    let decoding = null;
    if (detector !== null) {
      const legacyOptions = { legacyFontNames };
      if (legacyMap.size && decodesMyanmar(new DocumentDecoding("legacy", legacyMap, legacyPage, legacyOptions))) {
        decoding = new DocumentDecoding("legacy", legacyMap, legacyPage, legacyOptions);
        log(`[+] Decoding via ${legacyPageName ? JSON.stringify(legacyPageName) : "legacy"} character map`);
      } else if (pyTruthy(cmapMap) && decodesMyanmar(new DocumentDecoding("cmap", new CmapIdentityMap(cmapMap)))) {
        
        
        
        decoding = new DocumentDecoding("cmap", new CmapIdentityMap(cmapMap));
        log("[+] Decoding via embedded font cmap (glyph truth) "
          + "+ identity fallback for exact-Unicode fonts");
      } else if (pyTruthy(tuMap) && decodesMyanmar(new DocumentDecoding("tounicode", tuMap))) {
        decoding = new DocumentDecoding("tounicode", tuMap);
        log("[+] Decoding via ToUnicode/sidecar map");
      }
    }
    if (decoding === null) {
      if (legacyMap.size) decoding = new DocumentDecoding("legacy", legacyMap, legacyPage, { legacyFontNames });
      else if (pyTruthy(cmapMap)) decoding = new DocumentDecoding("cmap", cmapMap);
      else if (pyTruthy(tuMap)) decoding = new DocumentDecoding("tounicode", tuMap);
      else decoding = new DocumentDecoding("none");
    }

    if (decoding.kind === "none") {
      log("[!] No font cmap and no ToUnicode map; "
        + "unmapped codes will appear as [XXXX] placeholders");
    }

    /* VECTOR REPAIR. Some subsets leave a few glyphs unnamed -- the
       Burmese medials prominently -- and the decoder then emits nothing
       for them, so အကြီး reaches the reader as အကီး. The outlines are
       still in the file, so recover them by shape.

       Two passes. First a short probe with `recordBlind` set, which
       collects the ids that decode to nothing; then vote on just those,
       which is a handful of shapes rather than the whole font. The
       repair is consulted only where the decoder produced the empty
       string, so nothing that already decodes can be displaced. */
    if (vectorRepairEnabled(decoding)) {
      const blind = new Set();
      decoding.recordBlind = blind;
      const probeN = Math.min(VECTOR_REPAIR_PROBE_PAGES, npages);
      for (let i = 0; i < probeN; i += 1) {
        try {
          extractPageLines(objects, allPages[i][0], allPages[i][1], decoding);
        } catch { /* a page that will not parse tells us nothing more */ }
      }
      decoding.recordBlind = null;
      if (blind.size) {
        log(`[+] Vector repair: ${blind.size} unnameable glyph id(s)`
          + ` over ${probeN} probe page(s) -- matching by outline`);
        try {
          const repair = buildVectorRepair({ objects, getStream, fontRefs }, blind, { log });
          if (repair) {
            decoding.vectorRepair = repair;
            log(`[+] Vector repair: recovered ${repair.stats.recovered}`
              + `/${repair.stats.asked} glyph id(s) from ${repair.stats.fonts} subset(s)`);
          }
        } catch (err) {
          log(`[!] Vector repair unavailable: ${err && err.message ? err.message : err}`);
        }
      }
    }

    for (let idx = 0; idx < npages; idx += 1) {
      yield page(idx, decoding);
      if ((idx + 1) % 500 === 0) log(`    ... extracted ${idx + 1}/${npages} pages`);
    }
  }

  return [metadata, npages, generate()];
}


export function cleanupFor(cat, text) {
  return cat === "UNICODE" ? cleanupText(text) : null;
}


function convertLine(t, cat, applyCleanup) {
  if (cat === "ZAWGYI") return orderText(Rabbit.zg2uni(t)); 
  if (cat === "UNICODE" && applyCleanup) return cleanupText(t);
  return orderText(t);
}
function convLines(lines, cat, applyCleanup) {
  return lines.map(([x, y, size, t]) => [x, y, size, convertLine(t, cat, applyCleanup)]);
}


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


export function processPageRecord(pg, detector, applyCleanup, log = () => {}, wantLayout = false) {
  const idx = pg.idx;
  const raw = pg.text;
  const [category, prob] = detector.detect(raw);
  let cat = normCategory(category);

  /* A page decoded through the font's OWN tables -- its cmap, or its
     /ToUnicode -- cannot be Zawgyi. Those tables name code points, and they
     name the ones the font was built for; the characters on the page are
     whatever the table said, which is Unicode by construction.

     The detector does not know that. It reads the extracted string, and a
     shaped PDF stores its syllables in DRAWING order -- ေ and ြ ahead of the
     consonant they belong to -- which is also how Zawgyi is stored. So a
     correctly decoded Unicode page is judged Zawgyi, handed to Rabbit, and
     every code point rewritten: ယဲ့နင် became ယဲ့နင၏, စဉ်း became စǶး, and
     829 pages of a 4,414-page book came out as Latin Extended-B.

     Reordering happens after this (orderText), which is why the detector
     never sees the fixed sequence. So the verdict is corrected here, from
     evidence the text itself does not carry: identity and legacy decodes can
     genuinely be Zawgyi, and still go to Rabbit. */
  if (cat === "ZAWGYI" && (pg.decodeKind === "cmap" || pg.decodeKind === "tounicode")) {
    cat = "UNICODE";
    log(`    Page ${idx + 1}: ${category} verdict overridden -- `
      + `decoded from the font's own ${pg.decodeKind} table, so this is Unicode `
      + `in drawing order, not Zawgyi`);
  }

  if (cat === "UNKNOWN") {
    
    
    
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


export function processPdfStream(pdfSource, detector, applyCleanup, log = () => {}, wantLayout = false, options = {}) {
  const [metadata, npages, pages] = streamPdfPages(pdfSource, detector, log, options);

  function* reports() {
    for (const pg of pages) {
      yield processPageRecord(pg, detector, applyCleanup, log, wantLayout);
    }
  }

  return [metadata, npages, reports()];
}


function fmtProb(prob) {
  return Number.isFinite(prob) ? prob.toFixed(3) : (prob > 0 ? "inf" : "-inf");
}


export function collectStreamResults(pdfSource, detector, applyCleanup, log = () => {}, wantLayout = false, options = {}) {
  const [metadata, npages, reports] = processPdfStream(pdfSource, detector, applyCleanup, log, wantLayout, options);
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






export function processPdfBytes(data, detector, filename = "upload.pdf", log = () => {}, options = {}) {
  const source = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const [, npages, reportsIter] = processPdfStream(source, detector, false, log, true, options);
  const reports = [];
  const pages = [];
  const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
  let textChars = 0;
  for (const rep of reportsIter) {
    const cat = rep.category;
    const base = rep.text; 
    textChars += base.length;
    if (textChars > MAX_TEXT_CHARS) {
      throw new RuntimeError(`Extracted text exceeds the ${MAX_TEXT_CHARS} character cap`);
    }
    const clean = cleanupFor(cat, base); 
    reports.push({ page: rep.page, category: cat, prob: rep.prob, base, clean });
    pages.push({ text: base, lines: rep.lines, wh: rep.wh, hasImg: rep.hasImg });
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  const changes = collectChanges(reports);
  return {
    filename, kind: "pdf", reports, counts, metadata: {}, changes, pages, npages,
  };
}




export const DOCX_CHUNK_PARAGRAPHS = 80;

export function chunkParagraphs(paragraphs, perChunk = DOCX_CHUNK_PARAGRAPHS) {
  if (!paragraphs.length) return [""]; 
  const out = [];
  for (let i = 0; i < paragraphs.length; i += perChunk) {
    out.push(paragraphs.slice(i, i + perChunk).join("\n"));
  }
  return out;
}


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
    
    
    const base = cat === "ZAWGYI" ? orderText(Rabbit.zg2uni(chunk)) : orderText(chunk);
    const clean = cleanupFor(cat, base); 
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
export function processDocxBytes(data, detector, filename = "upload.docx", log = () => {}, { imageDir = null } = {}) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const paragraphs = extractDocxParagraphs(bytes, { includeImageMarkers: Boolean(imageDir) });
  const job = buildDocxJob(paragraphs, filename, detector, log);
  if (imageDir) job.imageFiles = extractDocxImages(bytes, imageDir);
  return job;
}


export async function processDocxBytesExternal(data, detector, filename = "upload.docx", log = () => {}) {
  validateDocxArchive(Buffer.isBuffer(data) ? data : Buffer.from(data));
  const paragraphs = await extractDocxParagraphsExternal(data);
  return buildDocxJob(paragraphs, filename, detector, log);
}

export const EXTERNAL_UNICODE_QUALITY_FLOOR = 0.5;
function externalQualityOk(counts) {
  const total = (counts.ZAWGYI ?? 0) + (counts.UNICODE ?? 0) + (counts.UNKNOWN ?? 0);
  if (total === 0) return false;
  return (counts.UNICODE ?? 0) / total >= EXTERNAL_UNICODE_QUALITY_FLOOR;
}


export async function processBytesDefault(data, kind, detector, filename = null, log = () => {}, options = {}) {
  const k = (kind || "").toLowerCase();
  if (k === "pdf") return processPdfBytes(data, detector, filename || "upload.pdf", log, options);
  if (k === "docx") {
    
    
    const probe = await processDocxBytesExternal(data, detector, filename || "upload.docx", log);
    log(externalQualityOk(probe.counts)
      ? "    mammoth probe passed; handing the original DOCX to PRASER"
      : "    mammoth probe failed the Unicode-readability check; handing the original DOCX to PRASER");
    return processDocxBytes(data, detector, filename || "upload.docx", log);
  }
  throw new Error(`Unsupported kind: ${JSON.stringify(kind)} (use 'pdf' or 'docx')`);
}


export function processBytes(data, kind, detector, filename = null, log = () => {}, options = {}) {
  const k = (kind || "").toLowerCase();
  if (k === "pdf") return processPdfBytes(data, detector, filename || "upload.pdf", log, options);
  if (k === "docx") return processDocxBytes(data, detector, filename || "upload.docx", log, options);
  throw new Error(`Unsupported kind: ${JSON.stringify(kind)} (use 'pdf' or 'docx')`);
}


export async function processBytesForMethod(data, kind, method, detector, filename = null, log = () => {}, options = {}) {
  const k = (kind || "").toLowerCase();
  if (k === "pdf" && isEncryptedPdf(data)) data = await decryptPdf(data, log);
  const runOptions = { ...options };
  const vectorEnabled = !/^(0|false|no|off)$/iu.test(String(process.env.PRASER_VECTOR_LAYOUT || "1"));
  if (k === "pdf" && vectorEnabled && !runOptions.vectorLayout) {
    runOptions.vectorLayout = await prepareVectorLayout(data, log);
  }
  const m = String(method || "default").toLowerCase();
  if (m === "manual") return processBytes(data, k, detector, filename, log, runOptions);
  if (m === "null") {
    if (k !== "docx") {
      throw new Error(`method:"null" is DOCX-only (no PDF path emits it); got kind=${JSON.stringify(kind)}`);
    }
    return processBytes(data, k, detector, filename, log, runOptions);
  }
  if (m === "default") return processBytesDefault(data, k, detector, filename, log, runOptions);
  throw new Error(`Unsupported method: ${JSON.stringify(method)} (use "default"/"manual"/"null")`);
}


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

/**
 * The PDF half of the "null" handling: a document that has a text layer AND
 * image areas worth reading.
 *
 * A scanned novel is the case that matters. It often does carry a text
 * layer, but it is noise -- whatever the scanning tool emitted -- while the
 * real content is in the page images. Extraction alone returns the noise;
 * OCR alone throws away a text layer that may be partly good. So both run:
 * the text core keeps what it found, every page carrying an image is
 * rendered and marked, and the manager sends those renders to the OCR lane
 * and stitches the result back over the markers -- the same contract DOCX
 * already uses, which is why the marker is no longer named after DOCX.
 */
export async function markPdfImagePages(bytes, job, imageDir, log = () => {}) {
  const files = [];
  const reports = Array.isArray(job?.reports) ? job.reports : [];
  for (let i = 0; i < reports.length; i += 1) {
    if (!reports[i]?.hasImg) continue;
    const id = String(files.length + 1).padStart(4, "0");
    const target = path.join(imageDir, `${id}-page${i + 1}.png`);
    try {
      const { png } = await renderPdfPagePng(bytes, i + 1);
      fs.writeFileSync(target, png, { mode: 0o600 });
    } catch (error) {
      log(`    Page ${i + 1}: render for OCR skipped (${error.message})`);
      continue;
    }
    const marker = `\n[[IMAGE_${id}]]`;
    if (job.pages?.[i]) job.pages[i].text = `${job.pages[i].text ?? ""}${marker}`;
    if (reports[i].clean != null) reports[i].clean = `${reports[i].clean}${marker}`;
    reports[i].text = `${reports[i].text ?? ""}${marker}`;
    files.push({ id, path: target });
  }
  return files;
}
