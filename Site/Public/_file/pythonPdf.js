// FILE: _file/pythonPdf.js
//
// The PDF parser slot in parser.js, backed by the PRASER Python extractor.
//
// Why PDFs do not get parsed in the browser
// ─────────────────────────────────────────
// A .txt or .docx stores text AS TEXT. A PDF stores GLYPH IDS plus a font, and
// the text you get back depends on being able to resolve those ids. Measured on
// upload/input/pdf/test.pdf (764 pages):
//
//   pdf.js  → "Chapter 701: ေကာငး့ကငးမီ့လြ္ဵတိုကးပျဲ"   p(zawgyi) = 1.000
//   PRASER  → "Chapter 701: ကောင်းကင်မီးလျှံတိုက်ပွဲ"   p(zawgyi) = 0.000
//
// The PDF's ToUnicode CMaps point at Zawgyi/imposter lookalikes, so pdf.js
// returns confident garbage. Running Rabbit over that output only half-converts
// it. The embedded TTF cmap is the only authority, and reading it is what the
// Python side does (pick_embedded_font / parse_ttf_cmap).
//
// Cost: the whole 764-page book extracts in ~2s using nothing but the Python
// standard library (re, zlib, struct, unicodedata, zipfile) — there is no
// dependency to install and no Flask process to keep alive, so this shells out
// to the same CLI you run by hand.

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .../Site/Public/PRASER/Python
const PRASER_PY = path.resolve(__dirname, '..', 'PRASER', 'Python');
const ENTRY = path.join('module', 'prase.py');

const DEFAULTS = {
  pythonBin: process.env.PYTHON_BIN || 'python3',
  // 764 pages ≈ 2s. A minute is already absurdly generous; the point is that a
  // malformed PDF can never pin a worker forever.
  timeoutMs: Number.parseInt(process.env.PRASER_TIMEOUT_MS || '60000', 10),
  // 'no' = never silently rewrite the user's text. The imposter/reorder cleanup
  // is a decision the user makes, not something we apply behind their back.
  cleanup: process.env.PRASER_CLEANUP || 'no',
  maxBuffer: 32 * 1024 * 1024, // stdout is only progress logging, but be safe
};

/**
 * Strip the metadata banner render_texts() writes at the top of the .txt.
 *
 * It carries the absolute source path, which must never reach the browser, but
 * it also carries the per-encoding page counts — worth keeping as metadata.
 *
 *   # Source: /abs/path/test.pdf
 *   # Pages: 764
 *   # Detection: 761 Zawgyi, 0 Unicode, 3 unknown
 *   ##################################################
 */
function splitBanner(raw) {
  const meta = { pages: null, zawgyi: null, unicode: null, unknown: null };
  const lines = raw.split('\n');
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{10,}\s*$/.test(line)) {
      i++;
      break;
    }
    if (!line.startsWith('#')) break; // no banner at all
    const pages = line.match(/^#\s*Pages:\s*(\d+)/i);
    if (pages) meta.pages = Number(pages[1]);
    const det = line.match(
      /^#\s*Detection:\s*(\d+)\s+Zawgyi,\s*(\d+)\s+Unicode,\s*(\d+)\s+unknown/i,
    );
    if (det) {
      meta.zawgyi = Number(det[1]);
      meta.unicode = Number(det[2]);
      meta.unknown = Number(det[3]);
    }
  }
  while (i < lines.length && lines[i].trim() === '') i++;
  return { text: lines.slice(i).join('\n'), meta };
}

/**
 * Build the pdfParser function that parser.js expects.
 *
 * @returns {(filePath: string) => Promise<string>} extracted Unicode text
 */
export function createPythonPdfParser(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };

  return async function parsePdfWithPython(filePath) {
    const outPath = path.join(
      os.tmpdir(),
      `praser_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.txt`,
    );

    try {
      await execFileAsync(
        cfg.pythonBin,
        [ENTRY, filePath, outPath, '--cleanup', cfg.cleanup],
        {
          cwd: PRASER_PY, // prase.py resolves its model/fonts relative to itself
          timeout: cfg.timeoutMs,
          maxBuffer: cfg.maxBuffer,
          killSignal: 'SIGKILL',
          windowsHide: true,
        },
      );
    } catch (err) {
      if (err.killed || err.signal === 'SIGKILL') {
        throw new Error(
          `PDF extraction timed out after ${cfg.timeoutMs}ms — the file is too large or malformed`,
          { cause: err },
        );
      }
      if (err.code === 'ENOENT') {
        throw new Error(
          `PDF extractor unavailable: '${cfg.pythonBin}' not found on PATH`,
          { cause: err },
        );
      }
      const detail = (err.stderr || err.message || '').toString().trim().split('\n').pop();
      throw new Error(`PDF extraction failed: ${detail}`, { cause: err });
    }

    let raw;
    try {
      raw = await fs.readFile(outPath, 'utf8');
    } catch {
      throw new Error('PDF extraction produced no output');
    } finally {
      await fs.unlink(outPath).catch(() => {});
    }

    const { text, meta } = splitBanner(raw);
    if (!text.trim()) {
      throw new Error(
        'No text found in this PDF. It is most likely a scan — image-only pages carry no text to extract.',
      );
    }

    parsePdfWithPython.lastMeta = meta; // observability, not contract
    return text;
  };
}
