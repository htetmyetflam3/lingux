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
// SERVICE, NOT SPAWN — the owner's two-web design
// ───────────────────────────────────────────────
// No binary is parsed inside the Site server process: the uploaded file is
// forwarded AS-IS (multipart, port-to-port on the same web) to the PRASER
// service (`module/api.py`, PRASER_ENDPOINT). The service runs the same
// detect → Rabbit → cleanup pipeline and answers with ONE plain text plus
// its internal job id. The job id is what the engine handshake hangs on:
// after the Site mints the submission identity it BINDS that identity to
// the job (/api/engine/bind), and the ENGINE — which initiates every
// cross-web connection — later presents the hidden-delivered metadata at
// /api/engine/collect and receives the text as the response. The engine
// never touches binaries; this module is the ONLY place a binary crosses
// the Site boundary, and it crosses unopened.
//
// (.doc remains the exception: legacy binary format, antiword/catdoc in
// parser.js. The docx RESULT rewrite still shells out to the CLI — the
// render side, not the parse side.)

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

/** The PRASER service (same web as the frontend — port-to-port in dev). */
export const PRASER_ENDPOINT = (
  process.env.PRASER_ENDPOINT || 'http://127.0.0.1:5005'
).replace(/\/$/, '');

const DEFAULTS = {
  // 764 pages ≈ 2s. A minute is already absurdly generous; the point is that a
  // malformed file can never pin a worker forever.
  timeoutMs: Number.parseInt(process.env.PRASER_TIMEOUT_MS || '60000', 10),
  // 'no' = never silently rewrite the user's text. The imposter/reorder cleanup
  // is a decision the user makes, not something we apply behind their back.
  cleanup: process.env.PRASER_CLEANUP || 'no',
};

/**
 * Build a parser function around the PRASER SERVICE (module/api.py).
 * Forwards the uploaded binary UNOPENED as multipart and returns the one
 * plain text the service extracted. The service's job id is remembered on
 * `client.lastJob` so the caller can bind the submission identity to it
 * once the Site has minted {submitId, filename}.
 *
 * @param {string} label - human label for error messages ('PDF' | 'DOCX')
 */
function createPraserServiceParser(label) {
  /** The most recent service job — { id, filename, kind, pages }. */
  const client = {
    lastJob: null,

    /**
     * Bind the minted submission identity onto the last job (the uploader
     * side of the engine handshake). Once per job — a second bind is 403.
     * @param {{ submitId: string, filename: string, userId: string,
     *           sessionId: string, formId: string }} metadata
     */
    async bindIdentity(metadata) {
      if (!client.lastJob?.id) {
        throw new Error(`${label} praser bind: no service job to bind`);
      }
      const res = await fetch(`${PRASER_ENDPOINT}/api/engine/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: client.lastJob.id, metadata }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `${label} praser bind ${res.status}: ${detail.slice(0, 200)}`,
        );
      }
      return res.json();
    },
  };

  client.parse = async function parseWithPraser(filePath) {
    const buf = await fs.readFile(filePath);
    const fd = new FormData();
    fd.append(
      'file',
      new Blob([buf]),
      path.basename(filePath) || `upload.${label.toLowerCase()}`,
    );

    let json;
    try {
      const res = await fetch(`${PRASER_ENDPOINT}/api/preview`, {
        method: 'POST',
        body: fd,
        signal: AbortSignal.timeout(DEFAULTS.timeoutMs),
      });
      json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `${label} preview ${res.status}`);
      }
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new Error(
          `${label} extraction timed out after ${DEFAULTS.timeoutMs}ms — the file is too large or malformed`,
          { cause: err },
        );
      }
      if (err.cause?.code === 'ENOENT' || err.code === 'ENOENT') {
        throw new Error(
          `${label} extractor unavailable: PRASER service at ${PRASER_ENDPOINT} unreachable`,
          { cause: err },
        );
      }
      if (err instanceof TypeError) {
        throw new Error(
          `${label} extractor unavailable: PRASER service at ${PRASER_ENDPOINT} unreachable`,
          { cause: err },
        );
      }
      throw err;
    }

    // the service answers with the WHOLE document as one plain text —
    // no metadata banner, no page markers, no HTML tags
    const text = String(json.content ?? '');
    client.lastJob = {
      id: json.job_id ?? null,
      filename: json.filename ?? null,
      kind: json.kind ?? null,
      pages: json.pages ?? 0,
    };
    if (!text.trim()) {
      const hint =
        label === 'PDF'
          ? ' It is most likely a scan — image-only pages carry no text to extract.'
          : '';
      throw new Error(`No text found in this ${label}.${hint}`);
    }
    return text;
  };

  return client;
}

/** .pdf → PRASER service (embedded-cmap / model-first extraction + Rabbit). */
export function createPythonPdfParser() {
  return createPraserServiceParser('PDF');
}

/** .docx → PRASER service (same detect → Rabbit → cleanup pipeline, zip). */
export function createPythonDocxParser() {
  return createPraserServiceParser('DOCX');
}

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
    const cfg = {
      pythonBin: process.env.PYTHON_BIN || 'python3',
      timeoutMs: Number.parseInt(process.env.PRASER_TIMEOUT_MS || '60000', 10),
      maxBuffer: 32 * 1024 * 1024,
      ...opts,
    };

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
