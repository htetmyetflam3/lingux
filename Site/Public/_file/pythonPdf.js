// FILE: _file/pythonPdf.js
//
// The Node shell around the PRASER Python extractor — .pdf AND .docx.
//
// Why these formats do not get parsed in the browser
// ─────────────────────────────────────────────────
// A .txt or .docx stores text AS TEXT, a PDF stores GLYPH IDS plus a font —
// but for Burmese documents BOTH carry the same problem: the stored code
// points are Zawgyi/imposter-encoded, and a browser extractor (pdf.js,
// mammoth.js) hands them back verbatim. Only the Python side does the
// encoding work (embedded-TTF cmap resolution, model-first decoding,
// Zawgyi detection + Rabbit conversion). Measured on
// upload/input/pdf/test.pdf (764 pages):
//
//   pdf.js  → "Chapter 701: ေကာငး့ကငးမီ့လြ္ဵတိုကးပျဲ"   p(zawgyi) = 1.000
//   PRASER  → "Chapter 701: ကောင်းကင်မီးလျှံတိုက်ပွဲ"   p(zawgyi) = 0.000
//
// Which is why every FILE upload is parsed server-side now; only a plain
// text submission (no file) travels as request-carried text.
//
// Cost: the whole 764-page book extracts in ~2s using nothing but the Python
// standard library (re, zlib, struct, unicodedata, zipfile) — there is no
// dependency to install and no Flask process to keep alive, so this shells out
// to the same CLI you run by hand. (.doc is the exception: legacy binary
// format, handled by antiword/catdoc in parser.js.)

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
  // malformed file can never pin a worker forever.
  timeoutMs: Number.parseInt(process.env.PRASER_TIMEOUT_MS || '60000', 10),
  // 'no' = never silently rewrite the user's text. The imposter/reorder cleanup
  // is a decision the user makes, not something we apply behind their back.
  cleanup: process.env.PRASER_CLEANUP || 'no',
  maxBuffer: 32 * 1024 * 1024, // stdout is only progress logging, but be safe
};

/**
 * Build a parser function around the PRASER CLI (module/prase.py).
 * The CLI auto-detects pdf vs docx by the input extension; only the error
 * labels differ between the two shells.
 *
 * @param {string} label - human label for error messages ('PDF' | 'DOCX')
 */
function createPraserFileParser(label) {
  return function (opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };

    return async function parseWithPraser(filePath) {
      // --content: the extractor prints ONLY the document body to stdout —
      // one plain text, no metadata banner, no page markers, no HTML tags.
      // Progress logging goes to stderr (surfaced only on failure).
      let stdout;
      try {
        const { stdout: out } = await execFileAsync(
          cfg.pythonBin,
          [ENTRY, filePath, '--content', '--cleanup', cfg.cleanup],
          {
            cwd: PRASER_PY, // prase.py resolves its model/fonts relative to itself
            timeout: cfg.timeoutMs,
            maxBuffer: cfg.maxBuffer,
            killSignal: 'SIGKILL',
            windowsHide: true,
          },
        );
        stdout = out;
      } catch (err) {
        if (err.killed || err.signal === 'SIGKILL') {
          throw new Error(
            `${label} extraction timed out after ${cfg.timeoutMs}ms — the file is too large or malformed`,
            { cause: err },
          );
        }
        if (err.code === 'ENOENT') {
          throw new Error(
            `${label} extractor unavailable: '${cfg.pythonBin}' not found on PATH`,
            { cause: err },
          );
        }
        const detail = (err.stderr || err.message || '').toString().trim().split('\n').pop();
        throw new Error(`${label} extraction failed: ${detail}`, { cause: err });
      }

      const text = stdout ?? '';
      if (!text.trim()) {
        const hint =
          label === 'PDF'
            ? ' It is most likely a scan — image-only pages carry no text to extract.'
            : '';
        throw new Error(`No text found in this ${label}.${hint}`);
      }

      return text;
    };
  };
}

/** .pdf → PRASER (embedded-cmap / model-first extraction + Rabbit). */
export const createPythonPdfParser = createPraserFileParser('PDF');

/** .docx → PRASER (same detect → Rabbit → cleanup pipeline, zip container). */
export const createPythonDocxParser = createPraserFileParser('DOCX');

/**
 * Result rewrite: plain text → .docx via the PRASER CLI
 * (`prase.py <in.txt> <out.docx>` — write_docx_plain, one paragraph per
 * line). This is how a .docx upload is delivered after the Engine round
 * trip: sent to the engine as txt, re-wrapped as docx on the way back.
 *
 * @returns {(text: string, outPath: string) => Promise<string>} outPath
 */
export function createPraserDocxRenderer() {
  return function (opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };

    return async function renderDocxFromText(text, outPath) {
      const tmpTxt = path.join(
        os.tmpdir(),
        `praser_result_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.txt`,
      );
      await fs.writeFile(tmpTxt, text, 'utf8');
      try {
        await execFileAsync(
          cfg.pythonBin,
          [ENTRY, tmpTxt, outPath],
          {
            cwd: PRASER_PY,
            timeout: cfg.timeoutMs,
            maxBuffer: cfg.maxBuffer,
            killSignal: 'SIGKILL',
            windowsHide: true,
          },
        );
      } catch (err) {
        const detail = (err.stderr || err.message || '').toString().trim().split('\n').pop();
        throw new Error(`DOCX rewrite failed: ${detail}`, { cause: err });
      } finally {
        await fs.unlink(tmpTxt).catch(() => {});
      }
      return outPath;
    };
  };
}
