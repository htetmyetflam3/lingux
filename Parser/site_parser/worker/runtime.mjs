import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadDetector, processBytesForMethod, buildFinalPages, markPdfImagePages } from "../pipeline.mjs";
import { writeOutput } from "../write/emit.mjs";
import { scanText, formatScanReport, loadMap, dictionaryWords } from "../text/scan.mjs";
import { repairText } from "../text/repair.mjs";
import { MAX_INPUT_BYTES, MAX_INPUT_MB } from "../core/limits.mjs";
import { REGISTER_LOG } from "../core/paths.mjs";
import { startRecord, note, appendRecord, registerPath } from "../core/provenance.mjs";
import { installPassiveLog } from "../../../logen/site.js";

/* The praser runs in a worker thread, so the listener installed in index.js
   is in another thread and would never see these events. Worker stdout is
   the parent's stdout, so installing here puts the lines in the same place.
   Same switches, same default: off unless LOG_CHECKS/LOG_FILE say otherwise. */
installPassiveLog({
  file: process.env.LOG_FILE || "",
  checks: /^(1|true|on|yes)$/i.test(String(process.env.LOG_CHECKS ?? "")),
});

const scanLoggingEnabled = /^(1|true|yes|on)$/iu.test(String(process.env.PRASER_SCAN_LOGGING || ""));
const scanDictionaryPath = path.resolve(
  process.env.PRASER_SCAN_DICTIONARY || path.join(path.dirname(fileURLToPath(import.meta.url)), "../model/master.json.enc"),
);

/* One dictionary load per worker: the repair pass and the diagnostic scan have
   to arbitrate over the SAME word list, or the report describes text the writer
   never saw. */
let dictionaryData = null;
function dictionaryOnce() {
  if (dictionaryData === null) dictionaryData = loadMap(scanDictionaryPath) ?? {};
  return dictionaryData;
}

/**
 * Apply the dictionary-arbitrated repairs to finished page text.
 *
 * `text/repair.mjs` resolves the two confusions a code page cannot settle on
 * its own: a glyph shared between a letter and a digit (ဝ/၀, ရ/၇, ဉ/ဥ), and a
 * page number glued onto its heading once the dot leaders are gone. Each fires
 * only when the token is not a word and exactly one repaired variant is, so a
 * repair can neither invent a word nor choose between two readings.
 *
 * Returns the pages plus the tally, which belongs in the provenance record:
 * a changed word with no record of why is how a repair becomes a bug report.
 */
function repairPages(pages, words) {
  const totals = { pages: 0, repairs: 0, splits: 0 };
  if (!words || !words.size) return { pages, totals };
  const repairedPages = pages.map((page) => {
    const text = page?.text || "";
    if (!text) return page;
    const repaired = repairText(text, words);
    if (repaired.text === text) return page;
    totals.pages += 1;
    for (const item of repaired.repairs) totals.repairs += item.count;
    for (const item of repaired.splits || []) totals.splits += item.count;
    return { ...page, text: repaired.text };
  });
  return { pages: repairedPages, totals };
}

let detector = null;
export function detectorOnce() {
  if (detector === null) detector = loadDetector();
  return detector;
}

export function loadBytes({ inPath, data }) {
  const bytes = inPath
    ? fs.readFileSync(inPath)
    : data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
  }
  return bytes;
}

function writeDiagnosticScan(pages, outPath) {
  // Always scans. PRASER_SCAN_LOGGING only controls the on-disk report.
  const body = pages.map((page) => page.text || "").join("\n\n");
  const data = dictionaryOnce();
  const report = scanText(body, {
    dictionary: dictionaryWords(data),
    standalone: data?.mapData?.newClause?.standalone || [],
  });
  const summary = Object.entries(report)
    .map(([key, value]) => `${key} ${value.total}`)
    .filter((value) => !value.endsWith(" 0"));
  const scanTotals = Object.fromEntries(
    Object.entries(report).map(([key, value]) => [key, value.total]),
  );
  if (!scanLoggingEnabled) return { scanLog: null, scanSummary: summary, scanTotals };
  const scanPath = `${outPath}.scan.txt`;
  fs.writeFileSync(scanPath, formatScanReport(report, {
    source: path.basename(outPath),
    totalChars: body.length,
  }), { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(scanPath, 0o600);
  return { scanLog: scanPath, scanSummary: summary, scanTotals };
}

export function createSourceRunner({ kind, method, docxImages = false, pdfImages = false }) {
  return async function runSource(msg = {}) {
    const {
      filename, data, inPath, outPath,
    } = msg;
    let imageDir = null;
    const bytes = loadBytes({ inPath, data });
    const name = filename ?? (inPath ? path.basename(inPath) : null);
    // Authoring register: see core/provenance.mjs. Uploads record the same
    // facts as a terminal run -- the broken-document case that matters most
    // is the one that came in over the wire, where there is no stdout to read.
    const provenance = startRecord(name ?? inPath ?? "");
    const options = (docxImages || pdfImages)
      ? (imageDir = fs.mkdtempSync(path.join(os.tmpdir(), "linga-img-"))) && { imageDir, provenance }
      : { provenance };
    const job = await processBytesForMethod(
      bytes,
      kind,
      method,
      detectorOnce(),
      name ?? null,
      () => {},
      options,
    );

    // PDF image areas are rendered after extraction, because rendering is
    // async and the page walk is not. DOCX fills job.imageFiles during
    // extraction; from here on the two are the same shape.
    if (pdfImages && imageDir) job.imageFiles = await markPdfImagePages(bytes, job, imageDir);

    if (!outPath) return { result: job };

    // Repairs run on the finished text, immediately before the write, so the
    // output file and the scan report describe the same bytes.
    const { pages, totals: repairTotals } = repairPages(
      buildFinalPages(job, true),
      dictionaryWords(dictionaryOnce()),
    );
    const written = await writeOutput(outPath, pages, { counts: job.counts, source: name ?? "" });
    const { scanLog, scanSummary, scanTotals } = writeDiagnosticScan(pages, outPath);
    const repaired = repairTotals.repairs || repairTotals.splits ? { repair: repairTotals } : {};
    note(provenance, { detection: job.counts, output: outPath, scan: scanTotals, ...repaired });
    appendRecord(provenance, { file: registerPath(REGISTER_LOG) });

    return {
      filename: name ?? null,
      pages: pages.length,
      counts: job.counts,
      ...(scanLog ? { scanLog } : {}),
      ...(scanSummary?.length ? { scanSummary } : {}),
      ...(job.imageFiles ? { imageFiles: job.imageFiles, imageDir } : {}),
      ...repaired,
      ...written,
    };
  };
}
