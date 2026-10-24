/**
 * Manager — the PRASER job manager (formerly "segmentor", a misleading name:
 * this never segments graphemes, it routes and runs whole documents).
 *
 * Contract with the Site queue, per MANAGER-HANDOFF.md /
 * API-PAYLOAD.md (`origin/arena/01a0f0ae-linga` /
 * `origin/arena/01a0f10a-linga`):
 *
 *   type ManagerPayload = {
 *     job:    "extracting" | "ocr" | "extracting-analysis" | "conversion-analysis",
 *     method: "default" | "manual" | "null",   // "null" is the STRING "null"
 *     output: "txt" | "docx" | "pdf",
 *   };
 *
 * The uploaded file is transport, not part of the three-field routing
 * contract above — it travels alongside as filename/inPath/data, same as
 * before.
 *
 * Two decisions the manager alone makes (the Site queue explicitly does not):
 *
 *  1. LANE — extract vs OCR (MANAGER-HANDOFF.md's "Manager lane expectation"
 *     table). There is no separate `content`/"is this a scan" field in the
 *     deliberately minimal handoff, so `method` carries that signal for
 *     `job:"conversion-analysis"`, which can mean either lane:
 *
 *       job                                    | method    | lane
 *       ---------------------------------------|-----------|--------
 *       "ocr"                                  | "default" | OCR
 *       "extracting" / "extracting-analysis"    | any       | extract
 *       "conversion-analysis"                   | "default" | OCR
 *       "conversion-analysis"                   | "manual"  | extract
 *
 *     ("conversion-analysis" + "null" is not in the Site's table — "null" is
 *     DOCX-only by the method validation below, and OCR never applies to a
 *     DOCX, so it falls through to extract same as any other non-"default"
 *     method on that job.)
 *
 *     Still modelled on the walk / walk-reverse shape kept from the previous
 *     split:
 *
 *       walk          = the extractor worker  (prase.worker.mjs)
 *       walk reverse  = the OCR worker        (ocr.worker.mjs)
 *
 *     walk reverse does not rely on walk: an OCR-lane job is routed straight
 *     to the OCR worker, and the two workers never talk to each other.
 *
 *  2. METHOD, inside the extract lane — how the text is actually read
 *     (API-PAYLOAD.md §3):
 *
 *       "default" -> PDF: PRASER's own per-resource font decoder (the same
 *                    recovery parser that reads Zawgyi PDFs already reads
 *                    Unicode PDFs correctly — there is no separate PDF
 *                    reader to route to, so "default" and "manual" are the
 *                    same code path for PDF). DOCX: mammoth (the same
 *                    library the browser already ran) first, verified
 *                    against our own Zawgyi/Unicode detector, PRASER's own
 *                    decoder is the fallback when that text does not check
 *                    out as readable Unicode.
 *       "manual"  -> PRASER's own per-page/per-resource font decoder directly
 *                    (handles legacy/Zawgyi encodings mammoth cannot, for DOCX;
 *                    for PDF this is identical to "default", see above).
 *       "null"    -> DOCX only. Skip the images, extract text only — which
 *                    PRASER's own docx reader already does by construction.
 *
 *     `job:"ocr"` only ever carries `method:"default"` (the only method for
 *     that job — API-PAYLOAD.md §3) and always ignores the text layer.
 *
 * `output` normally equals the Site's requested final format, with one
 * override owned by the Site's proposal, not this file: `job` ==
 * `"conversion-analysis"` always asks the manager for `output:"docx"`
 * regardless of the file's real input format or the user's final choice
 * (MANAGER-HANDOFF.md §3). The manager does not remember the user's original
 * request past that override — the Site queue is the one holding it.
 */
import { Worker } from "node:worker_threads";
import crypto from "node:crypto";
import path from "node:path";
import { DEFAULT_OUTPUT_DIR } from "./paths.mjs";
import { WORKER_HEAP_MB, WORKER_TIMEOUT_MS } from "./resource-limits.mjs";

const EXTRACT_URL = new URL("./prase.worker.mjs", import.meta.url); // walk
const OCR_URL = new URL("./ocr.worker.mjs", import.meta.url); // walk reverse

const OUTPUT_TYPES = new Set(["txt", "docx", "pdf"]);
const JOBS = new Set(["extracting", "ocr", "extracting-analysis", "conversion-analysis"]);
const METHODS = new Set(["default", "manual", "null"]);

/** The input container the file actually is — inferred the same way the
 * extractor worker infers it, needed here only to reject `method:"null"` on
 * a PDF before dispatch instead of after a wasted round trip. */
function inferInputKind(job) {
  if (job?.inputKind) return String(job.inputKind).toLowerCase();
  const name = job?.filename || (job?.inPath ? path.basename(job.inPath) : "");
  return String(name).toLowerCase().endsWith(".docx") ? "docx" : "pdf";
}

/** Validate + normalise the three-field routing contract. Throws on anything
 * outside the agreed vocabulary — the Site does not invent private values and
 * neither does this. */
export function readManagerPayload(job) {
  const jobField = String(job?.job ?? "").toLowerCase();
  const method = String(job?.method ?? "default").toLowerCase();
  const output = String(job?.output ?? job?.outputType ?? "txt").toLowerCase().replace(/^\./, "");

  if (!JOBS.has(jobField)) {
    throw new Error(`Unsupported job: ${JSON.stringify(job?.job)} (use ${[...JOBS].join("/")})`);
  }
  if (!METHODS.has(method)) {
    throw new Error(`Unsupported method: ${JSON.stringify(job?.method)} (use ${[...METHODS].join("/")})`);
  }
  if (!OUTPUT_TYPES.has(output)) {
    throw new Error(`Unsupported output type: ${JSON.stringify(job?.output)} (use txt/docx/pdf)`);
  }
  if (jobField === "ocr" && method !== "default") {
    // API-PAYLOAD.md §3: "default" is the only method for job "ocr".
    throw new Error(`job:"ocr" only accepts method:"default" (got ${JSON.stringify(method)})`);
  }
  if (method === "null" && inferInputKind(job) !== "docx") {
    // API-PAYLOAD.md §4: "No PDF path emits it."
    throw new Error('method:"null" is DOCX-only (no PDF path emits it)');
  }

  return { job: jobField, method, output };
}

/** Extract vs OCR — the manager's lane decision, per MANAGER-HANDOFF.md's
 * "Manager lane expectation" table (see this module's doc comment). `job` alone
 * decides it for "ocr" (always OCR) and "extracting"/"extracting-analysis"
 * (always extract, any method); "conversion-analysis" needs `method` too,
 * since it is the only job that can mean either lane. */
export function route(job) {
  const { job: jobField, method } = readManagerPayload(job);
  if (jobField === "ocr") return "ocr";
  if (jobField === "conversion-analysis" && method === "default") return "ocr";
  return "extract";
}

/**
 * MANAGER-HANDOFF.md §3: `output` normally equals the Site's requested final
 * format; `job:"conversion-analysis"` is the sole override and always sends
 * "docx" to the manager, no matter what the file or the user asked for.
 */
export function resolveOutput(job) {
  const { job: jobField, output } = readManagerPayload(job);
  return jobField === "conversion-analysis" ? "docx" : output;
}

export class Manager {
  constructor({ outputDir = DEFAULT_OUTPUT_DIR } = {}) {
    this.outputDir = outputDir;
    this.workers = { extract: null, ocr: null };
    this.pending = new Map();
    this.laneTails = { extract: Promise.resolve(), ocr: Promise.resolve() };
    this.seq = 0;
  }

  _failLane(lane, error, worker) {
    if (this.workers[lane] === worker) this.workers[lane] = null;
    for (const [id, entry] of this.pending) {
      if (entry.lane !== lane) continue;
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(error);
    }
  }

  _worker(lane) {
    if (this.workers[lane]) return this.workers[lane];
    const url = lane === "ocr" ? OCR_URL : EXTRACT_URL;
    const w = new Worker(url, {
      resourceLimits: {
        maxOldGenerationSizeMb: WORKER_HEAP_MB,
        stackSizeMb: 8,
      },
    });
    w.on("message", (m) => {
      const entry = this.pending.get(m.id);
      if (!entry) return;
      this.pending.delete(m.id);
      clearTimeout(entry.timer);
      if (m.ok) entry.resolve(m);
      else entry.reject(new Error(m.error || `${lane} worker failed`));
    });
    w.on("error", (error) => this._failLane(lane, error, w));
    w.on("exit", (code) => {
      if (code !== 0) this._failLane(lane, new Error(`${lane} worker exited (${code})`), w);
      else if (this.workers[lane] === w) this.workers[lane] = null;
    });
    this.workers[lane] = w;
    return w;
  }

  /** Assign the output file name in the requested type — the manager's half of "save". */
  _outPathFor(job, out) {
    if (job.outPath) return job.outPath;
    // Never derive a shared disk key from a client filename. Two uploads with
    // the same timestamped name must not overwrite or receive each other's
    // parser artifact.
    return path.join(this.outputDir, `${crypto.randomUUID()}.${out}`);
  }

  /**
   * Receive a job, read its {job, method, output}, route it to the extractor
   * or OCR worker with that method, and wait for the worker to build the file
   * + call back. Returns:
   *
   *   { file, filename, output, method, lane, pages, counts,
   *     lineCount, textChars, textBytes, mimeType, text? }
   *
   * `file` is the path the worker saved, for upstream to return to the user.
   * `filename` echoes the ORIGINAL source name (job.filename), so the Site's
   * queue can correlate this reply without holding onto its own request state.
   * `lineCount`/`textChars`/`textBytes`/`mimeType` describe the extracted
   * text and the output artifact — see emit.mjs's doc comment for exact
   * definitions; the Site already computes the artifact's file size and
   * SHA-256 itself, so those are not duplicated here.
   * `text` — the full extracted text — is present ONLY when `output` is
   * "docx": that is the one case where the Site/engine grammar-analysis
   * handshake still expects extracted text but the manager's artifact is a
   * document, not text (MANAGER-HANDOFF.md §3's `conversion-analysis`
   * override forces `output:"docx"` regardless of what was asked for). Read
   * `text` from this reply instead of re-opening the .docx artifact.
   */
  async dispatch(job) {
    const { method } = readManagerPayload(job);
    const lane = route(job);
    const out = resolveOutput(job);

    // A worker handles one document at a time. This prevents two large PDFs in
    // the same lane from multiplying heap use inside one worker thread.
    const previous = this.laneTails[lane];
    let releaseLane;
    const laneDone = new Promise((resolve) => { releaseLane = resolve; });
    this.laneTails[lane] = previous.catch(() => {}).then(() => laneDone);
    await previous.catch(() => {});

    try {
      const worker = this._worker(lane);
      const outPath = this._outPathFor(job, out);
      const id = ++this.seq;
      const payload =
        lane === "ocr"
          ? { id, op: "ocr", inPath: job.inPath, data: job.data, source: job.filename, outPath }
          : {
              id,
              op: "extract",
              method, // "default" | "manual" | "null" — read by prase.worker.mjs
              kind: job.inputKind, // optional; worker infers from the name otherwise
              filename: job.filename,
              inPath: job.inPath,
              data: job.data,
              outPath,
            };

      const reply = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`${lane} worker exceeded ${WORKER_TIMEOUT_MS} ms`));
          if (this.workers[lane] === worker) this.workers[lane] = null;
          worker.terminate().catch(() => {});
        }, WORKER_TIMEOUT_MS);
        timer.unref();
        this.pending.set(id, { resolve, reject, lane, timer });
        try {
          worker.postMessage(payload);
        } catch (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });

      const result = {
        file: reply.file,
        filename: job.filename ?? reply.filename ?? null,
        output: out,
        method,
        lane,
        pages: reply.pages,
        counts: reply.counts,
        lineCount: reply.lineCount,
        textChars: reply.textChars,
        textBytes: reply.textBytes,
        mimeType: reply.mimeType,
      };
      if (out === "docx" && "text" in reply) result.text = reply.text;
      return result;
    } finally {
      releaseLane();
    }
  }

  /** Run a sequence of jobs (the "input string") one after another. */
  async run(jobs) {
    const out = [];
    for (const job of jobs) out.push(await this.dispatch(job));
    return out;
  }

  async close() {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Parser manager is shutting down"));
    }
    this.pending.clear();
    const live = Object.values(this.workers).filter(Boolean);
    this.workers = { extract: null, ocr: null };
    await Promise.all(live.map((w) => w.terminate()));
  }
}
