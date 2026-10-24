/**
 * emit — shared output-file creation ("flush"), used by BOTH workers.
 *
 * The manager decides *how* a job is processed (extract vs OCR) and *what output
 * format* to hand back (txt / docx / pdf). This module is the one place that
 * turns processed pages into a file on disk in the requested format, so the
 * extractor worker and the OCR worker write files the same way.
 *
 * It is deliberately parser-free: it imports only the pure output writers in
 * `render.mjs` (fonts/pdf/zip infra), never the parser pipeline. That keeps the
 * OCR worker independent of the extractor — the reverse never depends on the
 * forward, even for writing.
 *
 * Output type is chosen by the file extension of `outPath`:
 *   .txt  -> header + per-page text
 *   .docx -> layout docx when pages carry layout, else plain docx
 *   .pdf  -> generated pdf
 *
 * Returns metadata alongside the written path, for the Site's processing
 * queue (it already computes file size/SHA-256 of the artifact itself, so
 * this only adds what it cannot get from the artifact alone):
 *   lineCount   total "\n"-split line count across every page's text.
 *   textChars   total character count of the extracted/recognised text
 *               (UTF-16 code units, i.e. `.length` — same unit `.txt`
 *               editors and most string tooling use).
 *   textBytes   the same text's UTF-8 byte length. Deliberately separate
 *               from textChars: Myanmar text runs ~3 bytes/char in UTF-8,
 *               and for .docx/.pdf output the artifact's own file size (which
 *               the Site already measures) reflects container/compression
 *               overhead, not the amount of text actually read.
 *   mimeType    of the OUTPUT artifact (by extension), not the input.
 *   text        the full extracted text (pages joined with "\n\n"), included
 *               ONLY for .docx output. This exists specifically so the
 *               Site/engine grammar-analysis handshake — which expects
 *               extracted text, not a document artifact — keeps working when
 *               `job:"conversion-analysis"` forces `output:"docx"`
 *               (MANAGER-HANDOFF.md §3): read `text` from this reply instead
 *               of parsing the .docx file back open. Omitted for .txt/.pdf
 *               output, where the artifact already IS (or trivially yields)
 *               the same text, to avoid doubling large payloads over the
 *               worker/queue transport for no reason.
 */
import fs from "node:fs";
import path from "node:path";
import { writeDocxLayout, writeDocxPlain, writePdf } from "./render.mjs";
import { MAX_PAGES, MAX_TEXT_CHARS } from "./resource-limits.mjs";

const MIME_TYPES = {
  ".txt": "text/plain",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
};

function header(source, pages, counts) {
  const c = counts || {};
  return (
    [
      `# Source: ${source || "-"}`,
      `# Pages: ${pages.length}`,
      `# Detection: ${c.ZAWGYI ?? 0} Zawgyi, ${c.UNICODE ?? 0} Unicode, ${c.UNKNOWN ?? 0} unknown`,
      "#".repeat(50),
    ].join("\n") + "\n\n"
  );
}

/** Sum of "\n"-split line counts across every page's text — a page with no
 * text at all (a still-blank OCR page, say) contributes 0, not 1. */
function countLines(texts) {
  let n = 0;
  for (const t of texts) if (t) n += t.split("\n").length;
  return n;
}

/**
 * Create the output file. `pages` is an array of page objects ({ text, lines?, … })
 * or plain strings. Returns { file, lineCount, textChars, textBytes, mimeType,
 * text? } — see the module doc comment for what each field means.
 */
export async function writeOutput(outPath, pages, { counts = {}, source = "" } = {}) {
  let out = outPath;
  let ext = path.extname(out).toLowerCase();
  if (ext === "") {
    ext = ".txt";
    out += ".txt";
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });

  if (!Array.isArray(pages) || pages.length > MAX_PAGES) {
    throw new Error(`Output exceeds the ${MAX_PAGES} page cap`);
  }
  const norm = pages.map((p) => (typeof p === "string" ? { text: p } : p || { text: "" }));
  const texts = norm.map((p) => p.text ?? "");
  let textChars = 0;
  for (const text of texts) {
    textChars += text.length;
    if (textChars > MAX_TEXT_CHARS) {
      throw new Error(`Output text exceeds the ${MAX_TEXT_CHARS} character cap`);
    }
  }
  const joined = texts.join("\n\n");

  if (ext === ".txt") {
    let body = header(source, norm, counts);
    for (let i = 0; i < texts.length; i += 1) {
      body += `--- Page ${i + 1} ---\n${texts[i] || ""}\n\n`;
    }
    fs.writeFileSync(out, body, "utf8");
  } else if (ext === ".docx") {
    // Use the layout writer only when pages actually carry layout; otherwise
    // (e.g. OCR text, DOCX input) fall back to a plain docx.
    if (norm.some((p) => Array.isArray(p.lines))) {
      await writeDocxLayout(out, norm, source);
    } else {
      await writeDocxPlain(out, joined);
    }
  } else if (ext === ".pdf") {
    writePdf(out, texts, {}, source, texts.length);
  } else {
    throw new Error(`Unsupported output type: ${ext} (use .txt/.docx/.pdf)`);
  }

  const result = {
    file: out,
    lineCount: countLines(texts),
    textChars: joined.length,
    textBytes: Buffer.byteLength(joined, "utf8"),
    mimeType: MIME_TYPES[ext],
  };
  if (ext === ".docx") result.text = joined;
  return result;
}

