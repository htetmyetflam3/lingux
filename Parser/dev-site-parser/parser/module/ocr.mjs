/**
 * Scanned-page OCR: the text-layer parsers cannot read a page that is only an image.
 *
 * A scanned PDF has no content stream text at all — the recovery parser finds
 * nothing (or throws on a synthetic page tree). The only way to get text out is
 * to rasterise the page and recognise the pixels, so this module is the second
 * front-end next to pdf-extract.mjs (the only text reader in this codebase,
 * used for both Zawgyi and Unicode PDFs — see pipeline.mjs):
 *
 *     scan -> render page (mupdf) -> tesseract.js -> text
 *
 * This deliberately does NOT use pdfjs-dist (which this codebase no longer
 * depends on at all). Rendering here means opening the same document and
 * rasterising it repeatedly in one call (page count, then every page, one OCR
 * pass at a time) — and pdfjs-dist's Node "fake worker" transfers
 * (structured-clones) the input bytes into its loopback port on the FIRST
 * getDocument() call, detaching the underlying ArrayBuffer. Any reuse of that
 * same source on a second call throws "Cannot transfer object of unsupported
 * type" — reproducible with nothing more than two back-to-back
 * `getDocument({data: sameUint8Array})` calls. A whole-book OCR run is a page
 * count plus N page renders against the same bytes, so this module cannot
 * "read once" the way a single-open text reader could. mupdf does not
 * transfer/detach its input, so it needs no such discipline and no extra
 * defensive copying at every call site.
 *
 * Both dependencies are OPTIONAL on purpose. Nothing else in this codebase
 * requires either `tesseract.js` or `mupdf`, so a normal install still works
 * for text-layer PDFs, and this module reports a clean error instead of a
 * stack trace when they are absent.
 *
 * Language note: tesseract's `mya` model is trained on UNICODE Myanmar. Measured on
 * a Zawgyi-One cover page, the OCR text is closer to the praser's converted Unicode
 * output than to the raw Zawgyi codepoints — a scan therefore lands in Unicode
 * already, and the normal per-page detect/convert step leaves it alone.
 *
 * Model selection: the DEFAULT model is no longer the stock
 * `@tesseract.js-data` `mya` package. `module/model/ocr/mya.traineddata.gz`
 * (vendored from github.com/pndaza/tesseract-myanmar, see the README next to
 * it) is bundled in this repo and used automatically, because the stock
 * model is missing several Myanmar characters and its own training text
 * mixes in Zawgyi — this fine-tuned one measures a materially lower error
 * rate across Myanmar Unicode fonts (see that README's table). This is also
 * configurable, for a different model entirely:
 *
 *   PRASER_OCR_LANG        which model(s) to load, "+"/","-separated, matching
 *                          the traineddata FILENAME without extension (default
 *                          "mya"). e.g. PRASER_OCR_LANG=pandaza for a custom
 *                          model shipped as pandaza.traineddata(.gz).
 *   PRASER_OCR_LANG_PATH   a directory to search FIRST, flat (no
 *                          @tesseract.js-data-style <lang>/<version>/
 *                          nesting): <dir>/<lang>.traineddata(.gz). Wins over
 *                          the bundled model above. Falls back, in order, to
 *                          the bundled model, the @tesseract.js-data package
 *                          layout (if installed), then tesseract.js
 *                          downloading a model once.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { OCR_MODEL_DIR } from "./paths.mjs";
import { MAX_OCR_PIXELS } from "./resource-limits.mjs";

const OCR_CACHE_DIR = path.join(os.tmpdir(), "linga-ocr");
const BUNDLED_OCR_MODEL_DIR = OCR_MODEL_DIR;
const DEFAULT_LANGS = (process.env.PRASER_OCR_LANG || "mya")
  .split(/[+,]/).map((s) => s.trim()).filter(Boolean);

let workerPromise = null;
let workerKey = null;

/** mupdf.js is the PDF engine for OCR rendering — see the module doc comment
 * for why this is not pdfjs-dist. */
async function loadMupdf() {
  try {
    return await import("mupdf");
  } catch {
    throw new Error("OCR needs the optional 'mupdf' package (npm install mupdf)");
  }
}

/** Does `dir` hold a traineddata file (gz or plain) for any of `langs`? Returns
 * the matching { lang, gzip } pair, or null. */
function findInDir(dir, langs) {
  if (!dir || !fs.existsSync(dir)) return null;
  for (const lang of langs) {
    if (fs.existsSync(path.join(dir, `${lang}.traineddata.gz`))) return { lang, gzip: true };
    if (fs.existsSync(path.join(dir, `${lang}.traineddata`))) return { lang, gzip: false };
  }
  return null;
}

/**
 * Prefer traineddata already on disk. Searched in order:
 *   1. PRASER_OCR_LANG_PATH, flat: <dir>/<lang>.traineddata(.gz) — a custom
 *      model directory dropped in by the operator.
 *   2. the model bundled in this repo (module/model/ocr/).
 *   3. the @tesseract.js-data package, if installed (unpkg layout:
 *      <lang>/<version>/<lang>.traineddata.gz).
 * Falling back to a cache dir lets tesseract.js download it once instead.
 * Returns { path, gzip } (gzip tells initOcr which filename tesseract.js
 * should look for), or null.
 */
function findLangPath(langs) {
  const customDir = process.env.PRASER_OCR_LANG_PATH;
  let hit = findInDir(customDir, langs);
  if (hit) return { path: path.resolve(customDir), gzip: hit.gzip };

  hit = findInDir(BUNDLED_OCR_MODEL_DIR, langs);
  if (hit) return { path: BUNDLED_OCR_MODEL_DIR, gzip: hit.gzip };

  const base = path.resolve("node_modules/@tesseract.js-data");
  if (fs.existsSync(base)) {
    for (const lang of langs) {
      const dir = path.join(base, lang);
      if (!fs.existsSync(dir)) continue;
      const versions = fs.readdirSync(dir)
        .filter((v) => fs.existsSync(path.join(dir, v, `${lang}.traineddata.gz`)))
        .sort()
        .reverse();
      if (versions.length) return { path: path.join(dir, versions[0]), gzip: true };
    }
  }
  return null;
}

/** Is the OCR front-end usable in this install? Never throws. */
export async function ocrAvailable() {
  try {
    await import("tesseract.js");
    await loadMupdf();
    return true;
  } catch {
    return false;
  }
}

/**
 * One tesseract worker per language set, reused for every page: worker startup is
 * the expensive part, recognition is not. `langs` defaults to PRASER_OCR_LANG
 * (itself defaulting to "mya") so an operator can switch models without
 * touching any caller.
 */
export async function initOcr({ langs = DEFAULT_LANGS, log = () => {} } = {}) {
  const key = langs.join("+");
  if (!workerPromise || workerKey !== key) {
    workerKey = key;
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const found = findLangPath(langs);
      const options = {
        cacheMethod: "none",
        logger: () => {},
        // See ocr-worker-no-relaxedsimd.cjs: tesseract.js 7's relaxedsimd
        // core aborts on float LSTM models (naptha/tesseract.js#1080), which
        // is exactly what the bundled mya model is.
        workerPath: path.join(path.dirname(fileURLToPath(import.meta.url)), "ocr-worker-no-relaxedsimd.cjs"),
      };
      if (found) {
        options.langPath = found.path;
        options.gzip = found.gzip; // filename tesseract.js looks for: <lang>.traineddata(.gz)
      } else {
        fs.mkdirSync(OCR_CACHE_DIR, { recursive: true });
        options.cachePath = OCR_CACHE_DIR;
      }
      log(`[+] OCR: tesseract.js ${key}${found ? ` (traineddata: ${path.relative(process.cwd(), found.path)})` : " (downloads traineddata once)"}`);
      return createWorker(langs, 1, options);
    })();
  }
  return workerPromise;
}

function openDoc(mupdf, source) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  return mupdf.Document.openDocument(bytes, "application/pdf");
}

/**
 * Does this page actually draw an image? Used to tell a SCAN (image-only page)
 * apart from a page that is simply blank: recognising a blank page makes the model
 * hallucinate stray syllables, which would corrupt an otherwise clean document.
 */
export async function pageHasImage(source, pageNumber) {
  const mupdf = await loadMupdf();
  const doc = openDoc(mupdf, source);
  try {
    const page = doc.loadPage(pageNumber - 1);
    let found = false;
    const device = new mupdf.Device({
      fillImage: () => { found = true; },
      fillImageMask: () => { found = true; },
    });
    try {
      page.run(device, mupdf.Matrix.identity);
    } finally {
      device.close();
      page.destroy();
    }
    return found;
  } finally {
    doc.destroy();
  }
}

/** Page count without keeping the document — the OCR loop needs it up front. */
export async function pdfPageCount(source) {
  const mupdf = await loadMupdf();
  const doc = openDoc(mupdf, source);
  try {
    return doc.countPages();
  } finally {
    doc.destroy();
  }
}

/**
 * Rasterise ONE page and recognise it. `scale` trades accuracy against speed:
 * 3 is ~216 dpi for a 72 dpi page, which is where the Myanmar model reads well.
 */
export async function ocrPdfPage(source, pageNumber, { scale = 3, log = () => {} } = {}) {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 4) {
    throw new Error("OCR scale must be greater than zero and at most 4");
  }
  const mupdf = await loadMupdf();
  const doc = openDoc(mupdf, source);
  let png;
  try {
    const page = doc.loadPage(pageNumber - 1);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      const width = Math.ceil(Math.abs(x1 - x0) * scale);
      const height = Math.ceil(Math.abs(y1 - y0) * scale);
      const pixels = width * height;
      if (
        !Number.isSafeInteger(pixels) ||
        width < 1 ||
        height < 1 ||
        pixels > MAX_OCR_PIXELS
      ) {
        throw new Error(`OCR page exceeds the ${MAX_OCR_PIXELS} pixel cap`);
      }
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
      try {
        png = pixmap.asPNG();
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }

  const worker = await initOcr({ log });
  const { data } = await worker.recognize(png);
  return data.text;
}

/** Tear the worker down (the CLI does this once, at the end). */
export async function closeOcr() {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch { /* worker never started */ }
  workerPromise = null;
  workerKey = null;
}
