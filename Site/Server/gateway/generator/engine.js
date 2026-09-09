// FILE: Server/gateway/generator/engine.js
//
// The Site → Private (Engine) connection. Previously openFsmConnection()
// (string.js) — a stub returning {connected:true} that never reached the
// engine. This is the seam Ginit.js said it was waiting for: validate the
// caller's id, run the pipeline, hand back BOTH ids.
//
// FILE vs BODY — the decision
// ───────────────────────────
// The parsed text is sent in the request BODY ({ text }), never as a file:
//
//   1. readFromApi.js (Module B) is the ENGINE's internal reader — paths
//      resolve against the ENGINE's cwd. It is how the engine reads files
//      AFTER staging, not a transport a caller can hand a file through.
//      invokeWithHash (Module A) only builds filenames for files the ENGINE
//      itself wrote (segmented_{hash}_*.txt).
//   2. api-server.js already defines the body path: `text` is staged into a
//      temp file in the engine's OWN workspace and read through the FSM
//      stream reader (256 KB chunks) — "the caller does not stream, the
//      engine side does". Body cap: MAX_PAYLOAD_MB (256 MB default); a
//      764-page book is ~380 KB of text.
//   3. `srcPath` works only on a shared filesystem (the code itself calls it
//      the "same machine test setup") — but Site and Engine deploy
//      separately. No shared disk in production → body.
//
// VALIDATORS, NOT OPTIONS
// ───────────────────────
// The engine PRE-RECEIVES the submission metadata (POST /metadata — the
// same pre-receive the hidden /api/process flow performs in production)
// before any text is allowed across. The push must align with it exactly:
//
//   filename    the FRONTEND-created name ({submitId}{ext}, responses.js)
//   userId      the caller's DB id (cookie chain)
//   sessionId   the visitor/session hash from the session cookie
//   textSha256  sha256 of the text — registered before the push, verified
//               on arrival, so a tampered/swapped body is rejected
//   textBytes   utf8 byte length
//
// A push that misses or misaligns on ANY of these is rejected (403) and
// the pre-received record is burned: one record authorises at most one
// push. No chaining — the Python PRASER never calls the engine; this
// bridge is the only Site→Engine path and it only speaks through the gate.
//
// The HASH travels with the body: we pass `hash: submitId` (a uuid — the one
// shape hashKind() accepts besides the engine's own timestamp). runMain()
// names the outputs segmented_{submitId}_*.txt, so the join key between the
// submissions row and the engine files is the id the server already holds.
//
// Cross-deployment note: reading the result back via invokeWithHash works
// while both halves share this repo (same-repo import, like logen.js /
// map-loader.js). When the deployments split, this read becomes an HTTP pull
// from the engine side — not wired yet, do not assume it exists.

import crypto from 'crypto';
import { hashKind, invokeWithHash } from
  '../../../../Private/Engine/Ginit.js';

const DEFAULTS = {
  endpoint: process.env.ENGINE_ENDPOINT || 'http://localhost:9000',
  key: process.env.ENGINE_KEY || process.env.FSM_KEY || '',
  // runMain() rebuilds the syllable tree per call — a whole book takes real
  // time. 5 min before we give up on the engine (the upload itself survives).
  timeoutMs: Number.parseInt(process.env.ENGINE_TIMEOUT_MS || '300000', 10),
};

/**
 * Site → Private. Two steps, strictly validated, no chaining:
 *   1. POST /metadata — the engine pre-receives the validators.
 *   2. POST /process  — the text, in the body, carrying the same validators.
 */
export function createEngineBridge(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };

  async function pushToEngine({ submitId, filename, text, metadata = {} }) {
    // 1) The id becomes an engine filename — refuse unusable shapes here,
    //    with the same verdict the engine would give.
    const kind = hashKind(submitId);
    if (!kind) {
      throw new Error(`engine bridge: unusable id ${JSON.stringify(submitId)}`);
    }
    // 2) Validators are NOT optional. The filename must be the one the
    //    frontend created; the identity must be the cookie chain's.
    if (!filename || !String(filename).startsWith(submitId)) {
      throw new Error(
        'engine bridge: filename required and must be the frontend-created name ({submitId}{ext})',
      );
    }
    const { formId, userId, sessionId, source, originalName } = metadata;
    if (userId === undefined || userId === null || userId === '') {
      throw new Error('engine bridge: userId is a required validator');
    }
    if (!sessionId) {
      throw new Error(
        'engine bridge: sessionId (cookie identity) is a required validator',
      );
    }

    const textSha256 = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    const textBytes = Buffer.byteLength(text, 'utf8');

    // 3) Pre-receive: the engine learns what the push MUST look like.
    const pre = await fetch(`${cfg.endpoint}/metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.key ? { 'X-API-Key': cfg.key } : {}),
      },
      body: JSON.stringify({
        formId,
        submitId,
        filename,
        userId,
        sessionId,
        source,
        originalName,
        textSha256,
        textBytes,
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!pre.ok) {
      const detail = await pre.text().catch(() => '');
      throw new Error(
        `engine /metadata ${pre.status}: ${detail.slice(0, 300) || pre.statusText}`,
      );
    }

    // 4) Push the text in the body, tagged with the same validators.
    const res = await fetch(`${cfg.endpoint}/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.key ? { 'X-API-Key': cfg.key } : {}),
      },
      body: JSON.stringify({
        text,
        hash: submitId, // outputs land as segmented_{submitId}_*.txt
        filename,
        userId,
        sessionId,
        writeSyllable: true,
        writePos: true,
        segmentedMode: 'single',
        debugMode: false,
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `engine /process ${res.status}: ${detail.slice(0, 300) || res.statusText}`,
      );
    }
    const { hash, syllable } = await res.json();
    if (!hash) throw new Error('engine /process returned no hash');

    // 5) Read the processed text back from the engine's output dir —
    //    Module A (invokeWithHash) → Module B (readFromApi, 256 KB chunks).
    const resultText = await invokeWithHash(hash);

    return {
      connected: true,
      submitId,
      engineHash: hash,
      syllableCount: Array.isArray(syllable) ? syllable.length : 0,
      text: resultText,
    };
  }

  return { push: pushToEngine };
}
