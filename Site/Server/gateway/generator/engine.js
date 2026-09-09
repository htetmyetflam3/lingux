// FILE: Server/gateway/generator/engine.js
//
// The Site → Private (Engine) connection — the owner's two-web design:
//
//   hidden.js ──(KEY: FSM_KEY)──▶ engine POST /fsm
//        the trusted DB side DELIVERS the submission metadata into the
//        engine's pre-receive cache ahead of time (≥20 records, TTL).
//        Key + caller IP + origin gate. This DELIVERY TRIGGERS the
//        engine: it immediately opens the connection to the PDF praser.
//
//   engine ──(engine initiates, cross-web)──▶ PDF praser /api/engine/collect
//        the engine PRESENTS the delivered metadata; the praser cross-
//        checks it against the identity the uploader side bound (incoming
//        → /api/engine/bind, port-to-port on the frontend's web) and
//        RESPONDS WITH THE TEXT once parsing finishes. No key on this
//        hop — the delivered metadata IS the key. Misaligned → 403 +
//        burned binding; not-ready-yet → 404 and the engine keeps
//        waiting (bounded).
//
//   Site server ──(KEY)──▶ engine GET /result/:hash
//        this bridge polls the outcome, then reads the processed text
//        back (invokeWithHash — Module A → Module B, readFromApi's FSM
//        stream, \n-boundary yields).
//
// The binary (PDF/docx) is only ever touched by the PRASER service: the
// Site forwards it unopened (multipart, same web) and the engine never
// sees it at all. The Site server and the engine deal in metadata and
// plain text only.
//
// VALIDATORS, NOT OPTIONS (client side of the same contract)
// ──────────────────────────────────────────────────────────
//   filename    the FRONTEND-created name ({submitId}{ext}, responses.js)
//   userId      the caller's DB id (cookie chain)
//   sessionId   the visitor/session hash from the session cookie
//   textSha256  sha256 of the parsed text — delivered by hidden and
//               verified by the engine against the praser's response
//   textBytes   utf8 byte length
//
// This bridge refuses to even dial the engine without them.
//
// The HASH travels with the delivery: we pass the submitId (a uuid — the one
// shape hashKind() accepts besides the engine's own timestamp). The engine
// processes under it and names the outputs segmented_{submitId}_*.txt, so
// the join key between the submissions row and the engine files is the id
// the server already holds.
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
  // The engine waits for the praser itself (ENGINE_COLLECT_TIMEOUT_MS on
  // the engine side); this is how long the SITE keeps polling before it
  // gives up (the upload itself survives).
  timeoutMs: Number.parseInt(process.env.ENGINE_TIMEOUT_MS || '300000', 10),
  pollMs: Number.parseInt(process.env.ENGINE_POLL_MS || '600', 10),
};

/**
 * Site → Private. Deliver the metadata (keyed), then poll the engine's
 * outcome — the engine does the praser handshake itself. Strictly
 * validated, no chaining.
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

    // 3) Deliver (KEYED /fsm). With the parsed text in hand we also deliver
    //    its sha/bytes — the engine verifies the praser's response against
    //    them, so the expectation comes from this trusted side, never from
    //    the text's own transport.
    const hasText = text !== null && text !== undefined;
    const textSha256 = hasText
      ? crypto.createHash('sha256').update(text, 'utf8').digest('hex')
      : null;
    const textBytes = hasText ? Buffer.byteLength(text, 'utf8') : null;

    const delivered = await fetch(`${cfg.endpoint}/fsm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': cfg.key,
      },
      body: JSON.stringify({
        formId,
        userId,
        sessionId,
        fileName: filename, // hidden's field name — the frontend-created name
        source,
        originalName: originalName ?? null,
        status: 'pending',
        submitId,
        textSha256,
        textBytes,
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!delivered.ok) {
      const detail = await delivered.text().catch(() => '');
      throw new Error(
        `engine /fsm ${delivered.status}: ${detail.slice(0, 300) || delivered.statusText}`,
      );
    }

    // 4) Poll the outcome — the engine is busy handshaking the praser.
    const deadline = Date.now() + cfg.timeoutMs;
    let outcome = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, cfg.pollMs));
      const res = await fetch(`${cfg.endpoint}/result/${encodeURIComponent(submitId)}`, {
        headers: { 'X-API-Key': cfg.key },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `engine /result ${res.status}: ${detail.slice(0, 300) || res.statusText}`,
        );
      }
      outcome = await res.json();
      if (outcome.error) {
        throw new Error(`engine collect failed: ${outcome.error}`);
      }
      if (outcome.done) break;
    }
    if (!outcome?.done || !outcome.engineHash) {
      throw new Error('engine collect timed out');
    }
    const { engineHash, syllableCount } = outcome;

    // 5) Read the processed text back from the engine's output dir —
    //    Module A (invokeWithHash) → Module B (readFromApi, 256 KB chunks).
    const resultText = await invokeWithHash(engineHash);

    return {
      connected: true,
      submitId,
      engineHash,
      syllableCount,
      text: resultText,
    };
  }

  return { push: pushToEngine };
}
