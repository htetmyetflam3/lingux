// FILE: _file/paths.js
// Central path map for ALL site file traffic. Everything flows into the
// PRASER Python project (the PDF parser dir that both the public site and
// the private engine feed into). No more junk dirs at the repo root.
//
// Paths resolve relative to THIS FILE, so they work from any cwd.
//
//   .../Site/Public/PRASER/Python/
//   ├── upload/input/{txt,pdf,docx}/   ← uploaded files, sorted by type
//   ├── upload/quarantine/             ← safety copy of every upload (pre-parse)
//   ├── output/txt/                    ← raw extracted text (what FSM pulls)
//   ├── output/original/               ← original copies (renamed by submitId)
//   └── logs/                          ← server logs (access, sql, cookie)

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .../Site/Public/PRASER/Python
export const PRASER_PY = path.resolve(__dirname, "..", "PRASER", "Python");

// ── Upload input (multer destination, sorted by file type) ──
export const INPUT_DIR = path.join(PRASER_PY, "upload", "input");
export const INPUT_TXT = path.join(INPUT_DIR, "txt");
export const INPUT_PDF = path.join(INPUT_DIR, "pdf");
export const INPUT_DOCX = path.join(INPUT_DIR, "docx"); // .doc + .docx

// ── Quarantine: safety copy of every upload, taken before parsing ──
export const QUARANTINE_DIR = path.join(PRASER_PY, "upload", "quarantine");

// ── Output: raw extracted text + original copies ──
// NOTE the leading dot: the private engine's path constants read
// File/.output/txt — so the public site must write .output, NOT output.
export const OUTPUT_DIR = path.join(PRASER_PY, ".output");
export const RAW_TXT_DIR = path.join(OUTPUT_DIR, "txt");
export const ORIGINAL_DIR = path.join(OUTPUT_DIR, "original");
// Rewritten results: a .docx upload goes to the Engine as txt and comes back
// re-wrapped as .output/docx/{submitId}.docx (see generator/engine.js).
export const OUTPUT_DOCX_DIR = path.join(OUTPUT_DIR, "docx");

// ── Server logs (access.log, sql.log, cookie.log, cookie-updates.log) ──
export const LOGS_DIR = path.join(PRASER_PY, "logs");

/** Pick the input dir for an uploaded file by its extension. */
export function inputDirFor(originalname = "") {
  const ext = originalname.split(".").pop().toLowerCase();
  if (ext === "txt") return INPUT_TXT;
  if (ext === "pdf") return INPUT_PDF;
  if (ext === "docx" || ext === "doc") return INPUT_DOCX;
  return INPUT_DIR;
}

/** Ensure every PRASER runtime dir exists (safe to call repeatedly). */
export function ensurePraserDirs() {
  for (const dir of [
    INPUT_TXT,
    INPUT_PDF,
    INPUT_DOCX,
    QUARANTINE_DIR,
    RAW_TXT_DIR,
    ORIGINAL_DIR,
    OUTPUT_DOCX_DIR,
    LOGS_DIR,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
