// FILE: gateway/proxy/jobs.js
//
// Extraction jobs — the reason a PDF upload can answer immediately.
//
// A .txt or .docx arrives already parsed by the browser, so there is nothing
// to wait for and its request stays synchronous. A PDF has to be read by the
// Python extractor, and holding the HTTP connection open for that is the wrong
// shape for this system: the site is hash/token driven, the client already
// polls by formId, and a browser tab sitting on an open socket is the one part
// of the chain that cannot survive a refresh.
//
// So the upload is validated, given a formId, and answered. The extraction runs
// behind that token and the client collects it by polling — the same path the
// engine result already uses.
//
// State lives in memory on purpose: a job is worthless once its .txt is on
// disk and its row is committed, which is the point at which the DB takes over
// as the source of truth. Nothing here needs to survive a restart.

import { setInterval } from 'node:timers';

const TERMINAL = new Set(['done', 'failed']);

export function createJobRegistry({
  // Each extraction is a Python process. Unbounded, a handful of large PDFs
  // would fork enough interpreters to starve the event loop; queued work costs
  // nothing but a little latency.
  maxConcurrent = Number.parseInt(process.env.EXTRACT_CONCURRENCY || '2', 10),
  // How long a finished job stays collectable. Long enough for a client that
  // closed its laptop mid-poll, short enough to never be a memory leak.
  ttlMs = Number.parseInt(process.env.EXTRACT_TTL_MS || '600000', 10),
  sweepMs = 60_000,
} = {}) {
  const jobs = new Map();
  const waiting = [];
  let running = 0;

  function pump() {
    while (running < maxConcurrent && waiting.length) {
      const next = waiting.shift();
      running++;
      next();
    }
  }

  function finish(formId, patch) {
    const job = jobs.get(formId);
    if (!job) return;
    Object.assign(job, patch, { finishedAt: Date.now() });
  }

  const sweeper = setInterval(() => {
    const cutoff = Date.now() - ttlMs;
    for (const [formId, job] of jobs) {
      if (TERMINAL.has(job.state) && job.finishedAt < cutoff) jobs.delete(formId);
    }
  }, sweepMs);
  sweeper.unref?.(); // never hold the process open

  return {
    /**
     * Register work for a formId and start it (or queue it). Returns at once —
     * the caller is expected to respond to the client immediately.
     */
    start(formId, work, meta = {}) {
      const job = {
        formId,
        state: 'queued',
        queuedAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        text: null,
        submitId: null,
        quota: null,
        error: null,
        ...meta,
      };
      jobs.set(formId, job);

      const run = async () => {
        job.state = 'extracting';
        job.startedAt = Date.now();
        try {
          const result = await work();
          finish(formId, { state: 'done', ...result });
        } catch (err) {
          console.error('[jobs] extraction failed for', formId, err);
          finish(formId, { state: 'failed', error: err.message });
        } finally {
          running--;
          pump();
        }
      };

      waiting.push(run);
      pump();
      return job;
    },

    get(formId) {
      return jobs.get(formId) || null;
    },

    /** Debug/ops view — not exposed to clients. */
    stats() {
      return { tracked: jobs.size, running, queued: waiting.length, maxConcurrent };
    },
  };
}
