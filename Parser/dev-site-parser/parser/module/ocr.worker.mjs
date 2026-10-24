/**
 * OCR worker — image/scanned page recognition, in its OWN worker thread.
 * In the manager's walk/walk-reverse metaphor this is "walk reverse"
 * (manager.mjs). The manager calls it as the OCR lane (as opposed to the
 * extractor lane) when a document has no usable text layer — `job:"ocr"`,
 * always `method:"default"` (the only method for that job). The important
 * twist: this reverse does NOT rely on the forward (extractor). It never
 * imports the parser pipeline — even the output-file writer it uses
 * (`emit.mjs`) is parser-free — and it is never messaged by the extractor
 * worker. The two workers do not talk to each other.
 *
 * Recognition deps (tesseract.js, mupdf) are lazy-loaded in `ocr.mjs`, so this
 * file loads even when they are absent; a recognise call then fails with a
 * clear message instead of crashing at startup.
 *
 * The worker owns disk I/O ("flush"): on the `ocr` op it LOADS its input (from
 * `inPath` on disk, or posted `data`), recognises every page, CREATES the output
 * file in the format implied by `outPath`, and calls back with just the file
 * name so an upstream module can hand the file to the user.
 *
 * Protocol (host -> worker):
 *   { id, op:"ocr", inPath?, data?, source?, outPath }        (load -> ocr -> flush)
 *   { id, type:"available" | "pageCount" | "pageHasImage" | "ocrPage" | "close", ... }
 * Reply: { id, ok, ... } or { id, ok:false, error }.
 */
import { parentPort } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import {
  ocrAvailable,
  pdfPageCount,
  pageHasImage,
  ocrPdfPage,
  closeOcr,
} from "./ocr.mjs";
import { writeOutput } from "./emit.mjs";
import {
  MAX_INPUT_BYTES,
  MAX_INPUT_MB,
  MAX_PAGES,
  MAX_TEXT_CHARS,
} from "./resource-limits.mjs";

if (!parentPort) {
  throw new Error("ocr.worker.mjs must be run as a worker thread");
}

function loadBytes({ inPath, data }) {
  const bytes = inPath
    ? fs.readFileSync(inPath)
    : data instanceof Uint8Array ? data : data ? new Uint8Array(data) : null;
  if (bytes && bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
  }
  return bytes;
}

/** OCR lane + flush: recognise every page and build the requested output file.
 * Reply carries the same metadata the extractor worker does (see emit.mjs's
 * doc comment) — `filename` echoes the ORIGINAL source name, not the output
 * file, so the Site's queue can correlate this reply back to its request. */
async function ocrToFile(msg) {
  const bytes = loadBytes(msg);
  const n = await pdfPageCount(bytes);
  if (n > MAX_PAGES) throw new Error(`PDF exceeds the ${MAX_PAGES} page cap`);
  const pages = [];
  let textChars = 0;
  for (let p = 1; p <= n; p += 1) {
    const text = await ocrPdfPage(bytes, p);
    textChars += text.length;
    if (textChars > MAX_TEXT_CHARS) {
      throw new Error(`OCR text exceeds the ${MAX_TEXT_CHARS} character cap`);
    }
    pages.push({ text });
  }
  const source = msg.source ?? (msg.inPath ? path.basename(msg.inPath) : "");
  const written = await writeOutput(msg.outPath, pages, {
    counts: { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 },
    source,
  });
  return { filename: source || null, pages: n, ...written };
}

async function handle(msg) {
  if (msg?.op === "ocr") return await ocrToFile(msg);
  const { type, pageNumber } = msg ?? {};
  const bytes = loadBytes(msg ?? {});
  switch (type) {
    case "available":
      return await ocrAvailable();
    case "pageCount":
      return await pdfPageCount(bytes);
    case "pageHasImage":
      return await pageHasImage(bytes, pageNumber);
    case "ocrPage":
      return await ocrPdfPage(bytes, pageNumber);
    case "close":
      await closeOcr();
      return true;
    default:
      throw new Error(`ocr.worker: unknown message ${JSON.stringify(type ?? msg?.op)}`);
  }
}

parentPort.on("message", async (msg) => {
  const { id } = msg ?? {};
  try {
    const res = await handle(msg);
    // flush ops reply with the file name; probe ops reply with a result.
    if (res && typeof res === "object" && "file" in res) {
      parentPort.postMessage({ id, ok: true, ...res });
    } else {
      parentPort.postMessage({ id, ok: true, result: res });
    }
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
