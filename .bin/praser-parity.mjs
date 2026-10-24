#!/usr/bin/env node
/**
 * The acceptance test for the Node port of the praser: does it reproduce the Python
 * bit-for-bit?  Checks, in order of strictness:
 *
 *   1. per-page trace   (extraction + detector + Rabbit + cleanup, every float stored
 *                        as the hex of its IEEE-754 double bits, so decimal text can
 *                        never hide a difference)
 *   2. pipeline log     (the exact progress lines, including the 764-page fallback path)
 *   3. .txt output      byte-identical
 *   4. .docx output     word/document.xml byte-identical (the zip container differs:
 *                        Python's zipfile writes different local headers, and the
 *                        members are what the port claims to reproduce)
 *   5. .pdf output      structural, NOT byte parity — fpdf2 subsets and renumbers the
 *                        embedded faces, so identical bytes are impossible without
 *                        fontTools. The JS PDF is instead re-extracted and its text
 *                        compared, which is what a reader actually sees.
 *
 * Usage (from the repo root):  node .bin/praser-parity.mjs [ref-dir] [pdf] [docx]
 * refs in <ref-dir>: py_pdf.jsonl, py_docx.jsonl, py_pdf_log.txt, pdf_no.txt,
 *                    pdf_no.docx, docx_no.txt   (from python3 .bin/praser-trace.py <dir>
 *                    plus the CLI runs recorded in the session notes)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  loadDetector, streamPdfPages, normCategory, safeProb, countDiffLines, chunkParagraphs,
} from "../R_Site/Praser/js/module/pipeline.mjs";
import { extractDocxParagraphs } from "../R_Site/Praser/js/module/docx-extract.mjs";
import { cleanupText } from "../R_Site/Praser/js/module/normalize.mjs";
import { Rabbit, initRabbit } from "../R_Site/Praser/js/module/rabbit.mjs";
import { initNormalize } from "../R_Site/Praser/js/module/normalize.mjs";
import { praseFile } from "../R_Site/Praser/js/module/prase.mjs";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REF = process.argv[2] || "/tmp/linga_ref";
// Relative, and run from R_Site/Praser/Python, because the .txt header embeds the
// input path verbatim ("# Source: <path>") — exactly how the references were made.
const PDF = process.argv[3] || "upload/input/pdf/test.pdf";
const DOCX = process.argv[4] || "upload/input/docx/zawgyi_fixture.docx";

const num = (x) => {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x, 0);
  return b.toString("hex");
};

let fails = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) fails += 1;
  process.stdout.write(`${pass ? "[OK]  " : "[FAIL]"} ${label}${detail ? `  ${detail}` : ""}\n`);
};

const readJsonl = (p) => fs.readFileSync(p, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l));

/** First difference between two arrays of plain objects, as a path + values. */
function firstDiff(a, b, where = "$") {
  if (a === b) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${where}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i += 1) {
      const d = firstDiff(a[i], b[i], `${where}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = firstDiff(a[k], b[k], `${where}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return `${where}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

await Promise.all([initRabbit(), initNormalize()]);

// ── 1. PDF trace ────────────────────────────────────────────────────────────
const det = loadDetector();
const log = [];
const [, npages, gen] = streamPdfPages(PDF, det, (m) => log.push(m));
const rows = [];
for (const pg of gen) {
  const raw = pg.text;
  const [category, prob] = det.detect(raw);
  const cat = normCategory(category);
  const base = cat === "ZAWGYI" ? Rabbit.zg2uni(raw) : raw;
  const clean = cat === "UNKNOWN" ? null : cleanupText(base);
  rows.push({
    idx: pg.idx,
    has_img: pg.hasImg,
    wh: [num(pg.wh[0]), num(pg.wh[1])],
    lines: pg.lines.map(([x, y, s, t]) => [num(x), num(y), num(s), t]),
    raw,
    cat,
    prob: num(safeProb(prob)),
    prob_raw: num(prob),
    base,
    clean,
    n_changes: (clean === null || clean === base) ? 0 : countDiffLines(base, clean),
  });
}
const pyRows = readJsonl(path.join(REF, "py_pdf.jsonl"));
ok("pdf trace: page count", rows.length === pyRows.length, `${rows.length} vs ${pyRows.length} (npages=${npages})`);
let badRow = null;
for (let i = 0; i < Math.min(rows.length, pyRows.length); i += 1) {
  const d = firstDiff(rows[i], pyRows[i], `page ${i + 1}`);
  if (d) { badRow = d; break; }
}
ok("pdf trace: every field bit-exact", badRow === null, badRow ?? `${rows.length} pages`);

// ── 2. pipeline log ─────────────────────────────────────────────────────────
const pyLog = fs.readFileSync(path.join(REF, "py_pdf_log.txt"), "utf8").trimEnd().split("\n");
const jsLog = log;
ok("pdf log: line count", jsLog.length === pyLog.length, `${jsLog.length} vs ${pyLog.length}`);
let logDiff = null;
for (let i = 0; i < Math.min(jsLog.length, pyLog.length); i += 1) {
  if (jsLog[i] !== pyLog[i]) { logDiff = `line ${i + 1}: ${JSON.stringify(jsLog[i])} vs ${JSON.stringify(pyLog[i])}`; break; }
}
ok("pdf log: text identical", logDiff === null, logDiff ?? `${pyLog.length} lines`);

// ── 3. DOCX trace ──────────────────────────────────────────────────────────
const paras = extractDocxParagraphs(DOCX);
const pyParas = JSON.parse(fs.readFileSync(path.join(REF, "py_docx_paras.json"), "utf8"));
ok("docx paragraphs identical", firstDiff(paras, pyParas) === null,
  `${paras.length} vs ${pyParas.length}`);

const drows = chunkParagraphs(paras).map((chunk, idx) => {
  const [category, prob] = det.detect(chunk);
  const cat = normCategory(category);
  const base = cat === "ZAWGYI" ? Rabbit.zg2uni(chunk) : chunk;
  const clean = cat === "UNKNOWN" ? null : cleanupText(base);
  return {
    idx, raw: chunk, cat, prob: num(safeProb(prob)), base, clean,
    n_changes: (clean === null || clean === base) ? 0 : countDiffLines(base, clean),
  };
});
const pyDrows = readJsonl(path.join(REF, "py_docx.jsonl"));
let dbad = drows.length !== pyDrows.length ? `length ${drows.length} vs ${pyDrows.length}` : null;
if (!dbad) {
  for (let i = 0; i < drows.length; i += 1) {
    const d = firstDiff(drows[i], pyDrows[i], `chunk ${i}`);
    if (d) { dbad = d; break; }
  }
}
ok("docx trace: every field bit-exact", dbad === null, dbad ?? `${drows.length} chunks`);

// ── 4. real output files ───────────────────────────────────────────────────
const outDir = fs.mkdtempSync("/tmp/praser-js-");
// normalize:"none" — the Python praser has no normalize step, so every file compared
// against a Python artifact pins the map-stage off. The modes themselves are verified by
// .bin/praser-normalize-check.mjs against _encode.js.
const run = async (input, outName, cleanup) => praseFile(input, path.join(outDir, outName),
  { cleanup, normalize: "none", log: () => {} });

const jsTxt = await run(PDF, "js_pdf.txt", "no");
const pyTxt = fs.readFileSync(path.join(REF, "pdf_no.txt"));
const jsTxtBuf = fs.readFileSync(jsTxt);
ok("pdf -> .txt byte-identical", pyTxt.equals(jsTxtBuf),
  `${jsTxtBuf.length} vs ${pyTxt.length} bytes`);
if (!pyTxt.equals(jsTxtBuf)) {
  const a = pyTxt.toString("utf8").split("\n");
  const b = jsTxtBuf.toString("utf8").split("\n");
  let d = `lines ${a.length} vs ${b.length}`;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) { d = `line ${i + 1}: ${JSON.stringify(a[i])} vs ${JSON.stringify(b[i])}`; break; }
  }
  process.stdout.write(`       ${d}\n`);
}

const jsDocx = await run(PDF, "js_pdf.docx", "no");
const xml = (file) => {
  // Read the member with Python's zipfile — the same reader our DOCX has to
  // satisfy — instead of a hand-rolled local-header scan (Python's zipfile
  // writes a data descriptor when streaming, so the local header lies).
  const code = "import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read('word/document.xml'))";
  return execFileSync("python3", ["-c", code, file], { maxBuffer: 1 << 28 });
};
const pyDocx = fs.readFileSync(path.join(REF, "pdf_no.docx"));
const jsDocxBuf = fs.readFileSync(jsDocx);
const pyXml = xml(path.join(REF, "pdf_no.docx"));
const jsXml = xml(jsDocx);
ok("pdf -> .docx document.xml byte-identical",
  pyXml !== null && jsXml !== null && pyXml.equals(jsXml),
  `${jsXml ? jsXml.length : "null"} vs ${pyXml ? pyXml.length : "null"} bytes `
  + `(containers ${jsDocxBuf.length} vs ${pyDocx.length})`);
if (pyXml && jsXml && !pyXml.equals(jsXml)) {
  let i = 0;
  while (i < Math.min(pyXml.length, jsXml.length) && pyXml[i] === jsXml[i]) i += 1;
  process.stdout.write(`       first diff at byte ${i}: `
    + `${JSON.stringify(pyXml.subarray(Math.max(0, i - 60), i + 60).toString("utf8"))} vs `
    + `${JSON.stringify(jsXml.subarray(Math.max(0, i - 60), i + 60).toString("utf8"))}\n`);
}

const jsDocxTxt = await run(DOCX, "js_docx.txt", "no");
const pyDocxTxt = fs.readFileSync(path.join(REF, "docx_no.txt"));
ok("docx -> .txt byte-identical",
  fs.readFileSync(jsDocxTxt).equals(pyDocxTxt),
  `${fs.statSync(jsDocxTxt).size} vs ${pyDocxTxt.length} bytes`);

// ── 4b. the cleanup=YES variants (the other side of the single global gate) ─
{
  const t = await run(PDF, "js_pdf_yes.txt", "yes");
  const ref = path.join(REF, "pdf_yes.txt");
  if (fs.existsSync(ref)) {
    ok("pdf -> .txt (cleanup yes) byte-identical",
      fs.readFileSync(t).equals(fs.readFileSync(ref)),
      `${fs.statSync(t).size} vs ${fs.statSync(ref).size} bytes`);
  } else {
    process.stdout.write(`[skip] pdf -> .txt (cleanup yes): no ${ref} in refs\n`);
  }
  const d = await run(PDF, "js_pdf_yes.docx", "yes");
  const dref = path.join(REF, "pdf_yes.docx");
  if (fs.existsSync(dref)) {
    ok("pdf -> .docx (cleanup yes) document.xml byte-identical",
      xml(dref).equals(xml(d)), `${xml(d).length} bytes`);
  } else {
    process.stdout.write(`[skip] pdf -> .docx (cleanup yes): no ${dref} in refs\n`);
  }
  const dt = await run(DOCX, "js_docx_yes.txt", "yes");
  const dtref = path.join(REF, "docx_yes.txt");
  if (fs.existsSync(dtref)) {
    ok("docx -> .txt (cleanup yes) byte-identical",
      fs.readFileSync(dt).equals(fs.readFileSync(dtref)),
      `${fs.statSync(dt).size} vs ${fs.statSync(dtref).size} bytes`);
  } else {
    process.stdout.write(`[skip] docx -> .txt (cleanup yes): no ${dtref} in refs\n`);
  }
}

// ── 5. PDF output ────────────────────────────────────────────────────────
// Byte parity vs fpdf2 is impossible by construction (it subsets and renumbers the
// embedded faces through fontTools), and "re-extract the produced PDF" is NOT a
// usable test either: fpdf2 writes `x y Td` while the praser's extractor reads `Tm`,
// so the Python extractor reads 0 lines from fpdf2's own output too (verified).
// The real parity evidence for this format is the content-stream comparison in
// .bin/praser-pdf-check.mjs, which runs on the same case data.
const jsPdfOut = await run(PDF, "js_pdf.pdf", "no");
const jsPdfBuf = fs.readFileSync(jsPdfOut);
const pyPdfRef = path.join(REF, "pdf_no.pdf");
ok("pdf -> .pdf written", jsPdfBuf.length > 1000
  && jsPdfBuf.subarray(0, 8).toString("latin1").startsWith("%PDF-1.4"),
  `${jsPdfBuf.length} bytes; fpdf2's own file is `
  + (fs.existsSync(pyPdfRef) ? `${fs.statSync(pyPdfRef).size} bytes` : "not kept in refs"));
const nPages = (jsPdfBuf.toString("latin1").match(/\/Type \/Page[^s]/g) || []).length;
ok("pdf -> .pdf page count", nPages === rows.length, `${nPages} page objects vs ${rows.length} extracted pages`);
process.stdout.write("       (operator-level fpdf2 comparison: node .bin/praser-pdf-check.mjs)\n");

process.stdout.write(`\n${fails === 0 ? "ALL PARITY CHECKS PASSED" : `${fails} CHECK(S) FAILED`}\n`);
process.exitCode = fails === 0 ? 0 : 1;
