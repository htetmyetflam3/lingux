// FILE: Server/gateway/generator/engine.js
//
// The Site → Private (Engine) connection — the owner's full design:
//
//   hidden.js ──(KEY: FSM_KEY)──▶ engine POST /fsm
//        the trusted DB side DELIVERS the submission metadata into the
//        engine's pre-receive cache ahead of time (≥20 records, TTL).
//        This is the only keyed endpoint; key + caller IP + origin gate.
//
//   praser side ──(NO key — accepted blindly)──▶ engine POST /metadata
//        the PDF-praser side DECLARES its metadata; the engine cross-
//        checks it against the hidden-delivered record. The metadata IS
//        the key here. Misaligned → 403, record burned, the text body
//        never crosses.
//
//   praser side ──(NO key)──▶ engine POST /process
//        the text in the body (or an empty-text pull signal when hidden
//        delivered a fileUrl — the engine pulls the raw txt itself and
//        validates it against the delivered sha/bytes). Must align with
//        the record; the record burns on first arrival (one delivery =
//        at most one accepted push, replays die).
//
// Two independent parties must agree before any text is processed: the
// engine's expectations come from hidden (or from the raw file it pulls)
// — never from the party being checked. No chaining, no retry.
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
//      stream reader (256 KB chunks, \n-boundary yields) — "the caller does
//      not stream, the engine side does". Body cap: MAX_PAYLOAD_MB.
//   3. `srcPath` works only on a shared filesystem (the code itself calls it
//      the "same machine test setup") — but Site and Engine deploy
//      separately. No shared disk in production → body.
//
// VALIDATORS, NOT OPTIONS (client side of the same contract)
// ──────────────────────────────────────────────────────────
//   filename    the FRONTEND-created name ({submitId}{ext}, responses.js)
//   userId      the caller's DB id (cookie chain)
//   sessionId   the visitor/session hash from the session cookie
//   textSha256  sha256 of the text — delivered by hidden, declared by the
//               praser side, verified on arrival
//   textBytes   utf8 byte length
//
// This bridge refuses to even dial the engine without them.
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
 * Site → Private. Three steps — hidden delivers, the praser side declares,
 * the praser side pushes. Strictly validated, no chaining.
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
    const { formId, userId, sessionId, source, originalName, fileUrl } = metadata;
    // originalName rides along for the engine's logs; not a validator
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

    // 3) hidden's half of the dance — KEYED. The same payload shape
    //    hidden.js POSTs from the DB row in production (fileName, fileUrl,
    //    status …). With sha+bytes attached the engine needs no raw pull.
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
        fileUrl: fileUrl ?? null,
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

    // 4) The praser side declares — BLIND on purpose (no key header): the
    //    engine cross-checks this against what hidden delivered.
    const declared = await fetch(`${cfg.endpoint}/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formId,
        submitId,
        filename,
        userId,
        sessionId,
        textSha256,
        textBytes,
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!declared.ok) {
      const detail = await declared.text().catch(() => '');
      throw new Error(
        `engine /metadata ${declared.status}: ${detail.slice(0, 300) || declared.statusText}`,
      );
    }

    // 5) Push the text in the body, tagged with the same validators.
    const res = await fetch(`${cfg.endpoint}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    // 6) Read the processed text back from the engine's output dir —
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
