/**
 * Port of the praser's CLI flow, minus argparse and --serve (the API/CLI surface is
 * out of scope for this port; this file is the callable entry the core parser needs).
 *
 * The one real entry point is praseFile(): resolve the output extension, load the
 * detector, then run the single-pass streaming pipeline
 *
 *     extract -> detect -> Rabbit -> cleanup -> normalize -> render
 *
 * `normalize` is the step the Python praser does NOT have: it comes from the map
 * runtime's tables and is the owner's pipeline stage. Modes:
 *   normalize (default) | mynormalize (corpus build: English blocks deleted) | none
 * `none` is what the Python-parity harness pins, so the port still reproduces the
 * Python byte-for-byte when the owner asks it to.
 *
 * ONE PAGE AT A TIME, exactly as cli.run_cli does. Format is decided by the OUTPUT
 * extension (there is no --pdf / --docx-layout flag); DOCX input is .txt-out only and
 * .txt input is the result-rewrite path (.docx out only).
 *
 * `main()` is a thin argv wrapper so `node module/prase.mjs in.pdf out.txt --cleanup no
 * --normalize none` reproduces the Python exactly. It is NOT a port of cli.py: the real
 * service is `R_Site/Praser/Python/module/api.py` on :5055.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_OUTPUT_DIR } from "./paths.mjs";
import {
  loadDetector,
  processPageRecord,
  processPdfStream,
  processDocxBytes,
  renderTexts,
} from "./pipeline.mjs";
import { ocrPdfPage, pdfPageCount, closeOcr } from "./ocr.mjs";
import { writeDocxPlain } from "./render.mjs";
import { initRabbit } from "./rabbit.mjs";
import { initNormalize, pickNormalize } from "./normalize.mjs";

let started = null;

/**
 * Load the Rabbit rule table (or the PRASER_RABBIT_MODULE seam) and the cleanup
 * table (or PRASER_NORMALIZE_MODULE). Must run before any conversion: with the seam
 * env vars set but no init, the local table would be used silently.
 */
export function init() {
  if (!started) started = Promise.all([initRabbit(), initNormalize()]).then(() => true);
  return started;
}

/**
 * run_cli(): the CLI body. Returns the output path (Python returns nothing).
 * options: { cleanup: "ask"|"yes"|"no", normalize: "normalize"|"mynormalize"|"none", log }
 */
export async function praseFile(inputPath, outArg = "", options = {}) {
  const {
    cleanup = "ask", normalize = "normalize", ocr = "auto",
    log = (m) => process.stdout.write(`${m}\n`),
  } = options;
  await init();

  if (!fs.existsSync(inputPath)) {
    log(`[-] Input not found: ${inputPath}`);
    throw new Error(`Input not found: ${inputPath}`);
  }

  const detector = loadDetector();

  // Resolve the output path FIRST: DOCX output needs the per-line layout
  // (x/y/font-size + MediaBox) carried through the streaming pass.
  let out = outArg || DEFAULT_OUTPUT_DIR;
  const ext = path.extname(out).toLowerCase();
  const baseName = path.basename(inputPath, path.extname(inputPath));
  let outPath;
  let outExt;
  if ([".txt", ".docx", ".pdf"].includes(ext)) {
    outPath = out;
    outExt = ext;
  } else {
    fs.mkdirSync(out, { recursive: true });
    outPath = path.join(out, `${baseName}.txt`);
    outExt = ".txt";
  }
  const outDir = path.dirname(path.resolve(outPath));
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const wantLayout = outExt === ".docx";

  const lower = inputPath.toLowerCase();

  // DOCX input runs the same pipeline but keeps no layout: txt output only.
  if (lower.endsWith(".docx") && outExt !== ".txt") {
    log("[-] DOCX input supports .txt output only (no layout is kept)");
    throw new Error("DOCX input supports .txt output only");
  }

  // Plain .txt input = the RESULT-REWRITE path: text (e.g. the Engine's processed
  // output) -> .docx for delivery. No extraction, no detection.
  if (lower.endsWith(".txt")) {
    if (outExt !== ".docx") {
      log("[-] .txt input supports .docx output only (use out.docx)");
      throw new Error(".txt input supports .docx output only");
    }
    // No normalization here: text on this path has already been through the engine's
    // own normalize/mapper stage, and re-wrapping would fight the {tokens} it carries.
    await writeDocxPlain(outPath, fs.readFileSync(inputPath, "utf8"));
    log(`[+] Saved: ${outPath}`);
    log("[+] Done.");
    return outPath;
  }

  // There is only one text parser now: the repository's own per-resource
  // font decoder (processPdfStream / processPdfBytes). It already reads
  // Zawgyi AND Unicode PDFs correctly on its own — the Zawgyi/Unicode
  // detector runs AFTER extraction (in processPageRecord) purely to decide
  // whether the Rabbit Zawgyi->Unicode conversion is needed, so a Unicode
  // page is already "auto handled" with no separate first-pass parser.
  // No probe is needed to route between two parsers, because there is no
  // second parser: `--ocr force` OCRs every page outright; `--ocr auto`
  // (the default) lets the recovery parser read every page and OCRs only
  // the pages it reports as image-only with no text (`rep.hasImg`, checked
  // page by page below — no upfront whole-document classification needed);
  // `--ocr off` never touches ocr.mjs at all.
  const useOcrParser = ocr === "force";
  let probedPages = 0;
  if (lower.endsWith(".pdf") && ocr === "force") {
    try {
      probedPages = await pdfPageCount(fs.readFileSync(inputPath));
    } catch (error) {
      log(`[-] OCR could not read the page tree: ${error.message}`);
      throw error;
    }
  }

  // --- The ONE global gate, asked BEFORE any page is touched ---
  let applyCleanup;
  if (cleanup === "ask") applyCleanup = askCleanupOnce();
  else if (cleanup === "yes") applyCleanup = true;
  else applyCleanup = false;
  log(`[+] Cleanup step (imposter + reorder): ${applyCleanup ? "APPLY" : "SKIP"}`);

  // --- Normalization mode, applied to every page's text and to every layout line,
  // AFTER the cleanup gate. pickNormalize(null/"none") -> no step at all. ---
  const norm = pickNormalize(normalize);
  const normalizeOne = (t) => (norm ? norm(t) : t);
  log(`[+] Normalize step: ${norm ? normalize : "SKIP"}`);

  // Single-pass streaming pipeline: extract -> detect -> convert -> cleanup,
  // ONE PAGE AT A TIME. Only final page texts (+ layout for docx) are kept.
  log("[+] Processing pages (single-pass stream)...");
  let counts;
  let pages;
  let totalChanges;
  if (lower.endsWith(".docx")) {
    const job = processDocxBytes(fs.readFileSync(inputPath), detector,
      path.basename(inputPath), log);
    counts = job.counts;
    pages = [];
    for (let i = 0; i < job.pages.length; i += 1) {
      const pg = job.pages[i];
      const rep = job.reports[i];
      const text = (applyCleanup && rep.clean != null) ? rep.clean : pg.text;
      pages.push({ text: normalizeOne(text) });
    }
    totalChanges = job.changes.length;
  } else {
    counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
    pages = [];
    totalChanges = 0;

    const keepReport = (rep) => {
      counts[rep.category] = (counts[rep.category] ?? 0) + 1;
      const p = { text: normalizeOne(rep.text) };
      for (const k of ["lines", "wh", "hasImg"]) if (k in rep) p[k] = rep[k];
      // .docx/.pdf output draws from the LINES, so they get the same step; the page
      // text stays the joined-by-"\n" form (newline is a mark in the map's reorder, so
      // whole-text and per-line are not the same string - same asymmetry as cleanup).
      if (norm && p.lines) {
        // layout lines are tuples [x, y, size, text] — the text is the LAST element.
        p.lines = p.lines.map((l) => {
          if (!Array.isArray(l) || typeof l[l.length - 1] !== "string") return l;
          const c = l.slice();
          c[c.length - 1] = norm(c[c.length - 1]);
          return c;
        });
      }
      pages.push(p);
      totalChanges += rep.nChanges;
    };

    const pdfSource = fs.readFileSync(inputPath);

    /** Recognise ONE page; never throws, returns "" when OCR is unusable. */
    const ocrPageText = async (pageNumber) => {
      try {
        return await ocrPdfPage(pdfSource, pageNumber, { log });
      } catch (error) {
        log(`    Page ${pageNumber}: OCR skipped (${error.message})`);
        return "";
      }
    };

    /** Last resort: no text reader at all, just recognise every page's pixels. */
    const ocrAllPages = async () => {
      const total = probedPages || await pdfPageCount(pdfSource);
      for (let n = 1; n <= total; n += 1) {
        const text = await ocrPageText(n);
        log(`    Page ${n}: OCR -> ${text.trim() ? "text" : "empty"}`);
        keepReport(processPageRecord(
          { idx: n - 1, text, lines: [], wh: [0, 0], hasImg: true },
          detector, applyCleanup, log, wantLayout,
        ));
      }
    };

    if (useOcrParser) {
      log("[i] OCR reads pixels: every page is recognised, not parsed (--ocr force).");
      await ocrAllPages();
    } else {
      let streamed = null;
      try {
        streamed = processPdfStream(inputPath, detector, applyCleanup, log, wantLayout);
      } catch (error) {
        // Document-level failure: a page tree the recovery parser cannot walk, or
        // a file with no text objects at all. If nothing has been produced yet,
        // OCR every page rather than dying with no output file.
        if (ocr === "off" || pages.length) throw error;
        log(`[i] Text parser could not read this PDF (${error.message}); `
          + "falling back to OCR for every page");
        await ocrAllPages();
      }
      if (streamed) {
        const [metadata, npages, reports] = streamed;
        void metadata;
        void npages;
        let pageNo = 0;
        for (const rep of reports) {
          pageNo += 1;
          // Per-page fallback: an image-only page among text pages comes back
          // empty from the recovery parser, so recognise that page and use the
          // result. The parser stays the front-end for every page that has text.
          if (ocr === "auto" && !rep.text.trim() && rep.hasImg) {
            const text = await ocrPageText(pageNo);
            if (text.trim()) {
              log(`    Page ${pageNo}: OCR fallback (recovery parser found no text)`);
              keepReport(processPageRecord(
                { idx: pageNo - 1, text, lines: rep.lines ?? [], wh: rep.wh, hasImg: true },
                detector, applyCleanup, log, wantLayout,
              ));
              continue;
            }
          }
          keepReport(rep);
        }
      }
    }
  }

  log(`[+] Detection done: ${counts.ZAWGYI ?? 0} Zawgyi, ${counts.UNICODE ?? 0} Unicode, `
    + `${counts.UNKNOWN ?? 0} unknown`);
  if (applyCleanup && totalChanges) {
    log(`[+] Cleanup applied: ${totalChanges} line(s) reordered/cleaned`);
  } else if (totalChanges) {
    log(`[i] ${totalChanges} line(s) would have changed (cleanup skipped)`);
  }

  await renderTexts(outPath, pages, counts, inputPath);
  log(`[+] Saved: ${outPath}`);
  log("[+] Done.");
  return outPath;
}

/** ask_cleanup_once(): one global y/N prompt, default No (EOF -> No). */
export function askCleanupOnce() {
  process.stdout.write("\n[?] Apply imposter cleanup + mark reorder? [y/N]: ");
  const buf = Buffer.alloc(1);
  let line = "";
  try {
    for (;;) {
      const n = fs.readSync(0, buf, 0, 1, null);
      if (n === 0) break;
      const c = buf.toString("latin1", 0, 1);
      if (c === "\n") break;
      line += c;
    }
  } catch { /* closed stdin -> default No, like Python's EOFError */ }
  const ans = line.trim().toLowerCase();
  return ans === "y" || ans === "yes";
}

export async function main(argv = process.argv.slice(2)) {
  const args = argv.slice();
  let cleanup = "ask";
  let normalize = "normalize";
  let ocr = "auto";
  const pos = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--cleanup") { cleanup = args[++i]; continue; }
    if (args[i] === "--normalize") { normalize = args[++i]; continue; }
    if (args[i] === "--ocr") { ocr = args[++i]; continue; }
    pos.push(args[i]);
  }
  if (!pos[0]) {
    process.stdout.write("Usage: node module/prase.mjs <input.pdf|input.docx> [output_path]"
      + " [--cleanup ask|yes|no] [--normalize normalize|mynormalize|none]"
      + " [--ocr auto|off|force]\n");
    process.exitCode = 1;
    return;
  }
  try {
    await praseFile(pos[0], pos[1] ?? "", { cleanup, normalize, ocr });
  } finally {
    await closeOcr();
  }
}

/** Running this file IS the CLI — the port of prase.py's `if __name__ == "__main__"`
 *  guard. Without it `node module/prase.mjs in.pdf out.txt` exited 0 doing nothing,
 *  while this file's own header documented that exact invocation. Importing the module
 *  (the parity harness, the API seam) still has no side effect. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
