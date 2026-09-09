

---

*Note* : **"previous changelog arent registerd here .so start registering fron 1.4.0"**
*Note* : **"previous changelog arent registerd here .so start registering fron 1.4.0"**


## [2.3.1] - 2026-09-09
### Added (defense-in-depth BEHIND the session boundary — validator + flood dam)
- Context (owner's model, exact): curl never exists in production. The boundary is the SESSION ID — only the frontend flow mints one (cookie chain), so curl without a session id is dead regardless of its JSON; production curl additionally dies at headerCheck's bot-UA regex. The DB ownership check materializes at the SAVE-TO-DISK stage (rawSaver writes, finalizeUpload lands the submissions row) as the last backstop. Even DEV_BYPASS_SESSION=true lets curl through ONLY because that flag deliberately opens BOTH headerCheck and the session gates in dev — and it is inert under NODE_ENV=production (fail closed). The flags exist for agents that cannot use the interactive UI. Nothing below adds or opens any curl door: the validator + dam are defense-in-depth BEHIND the session boundary (a spoofed-UA script or an abusive logged-in session), which the curl experiment merely demonstrated.
- `validatePublicText` (Server/gateway/text/validate.js): single pass, O(n), constant memory, NO regex on user input (no ReDoS). Zero control chars (NUL/\x01/ESC are smuggled binary, not prose), ≤16 U+FFFD (broken/double-encoded payloads), ≤64 invisible/format chars (zero-widths, BOM, bidi overrides — evasion carriers), 2M-char cap. REJECT, never rewrite (same rule as PRASER_CLEANUP=no). Burmese prose passes untouched.
- Flood dam: per-IP fixed window on /api/* (`RATE_LIMIT_MAX`/min, default 120, 429 + Retry-After) — the attack test showed 20 unauthenticated posts accepted in 200ms with 26 MB of disk written and no dam at all.
- Text JSON body cap 10mb -> 1mb (`TEXT_BODY_LIMIT`) — a text submission is not a file.
- Attack-test results (same curls, before -> after): control soup 202 -> 400; 5000x U+FFFD 202 -> 400; 3000x zero-width 202 -> 400; flood all-202 -> 202x18 then 429; legit Burmese text 202 -> 202 (no false positive). Suite ALL PASS twice.
## [2.3.0] - 2026-09-09
### Added (Cloudflare-readiness, next-layer prep)
- `Cache-Control: private, no-store` on the keyed raw-text endpoint (GET /api/hidden/raw/:submitId) — an edge cache must never hold submission text.
- `TRUST_PROXY` env on the Site: behind Cloudflare/reverse proxy it restores the real client IP + proto (req.ip, req.protocol, secure cookies). Unset = direct, unchanged.
- Note: the cookie chain was ALREADY Cloudflare-aware — cgen fingerprints `cf-connecting-ip` + `cf-ipcountry` (default MM) into deviceFingerprint.
## [2.2.0] - 2026-09-09
### Added
- Praser machine-boundary lock: the service is unauthenticated BY DESIGN for its own machine — but a caller arriving from a NON-loopback source address (port forward, preview proxy, stray container) must now carry `X-Praser-Key` matching the `.env` `PRASER_KEY`, and with no key configured non-loopback callers are refused entirely (fail closed). Found live: this sandbox's preview proxy forwards even loopback-bound ports — with the lock, that path serves nothing (403).
### Changed
- Praser binds `127.0.0.1` BY DEFAULT (`--host` is now an explicit operator decision); docs say so.
- PRASER default port retired from 5005 (was briefly exposed) -> 5055 everywhere (pythonPdf.js, api-server.js default `PRASER_ENDPOINT`, test suite).
- Engine boot banner now lists the real routes (/fsm, /result/:hash, /process, /health) instead of a stale /process hint.
### Docs
- PROJECTSTRUCTURE Corrections gained a READER'S LENS row: the append-only log records the whole journey — rows about /metadata declares, body-text pushes, /fsm raw pulls are historical (v1.7.0-v1.9.0); the current contract is /fsm delivery -> engine-initiated collect -> /result poll.
## [2.1.0] - 2026-09-09
### Added
- Zip/decompression-bomb guards — the praser is the ONLY binary-opening component, so it carries the armor (owner rationale: separate dirs, port-to-port, keep bombs away from Site and engine):
  - PDF: FlateDecode streams decompress under a hard cap (`PRASER_MAX_STREAM_MB`, 256) — a cap hit REFUSES the document loudly instead of returning empty text.
  - DOCX: `word/document.xml` is refused when the member exceeds `PRASER_MAX_MEMBER_MB` (256) or compresses beyond a 200x ratio (real documents are ~10-30x; bombs are 1000x).
  - Praser door: `PRASER_MAX_UPLOAD_MB` (64) via Flask MAX_CONTENT_LENGTH, JSON 413.
  - Site door: multer `fileSize` cap (`UPLOAD_MAX_MB`, 64) — the Site only shuttles bytes, but its door has a size too.
- Test section 10: a real 512 MB-of-zeros docx (~500 KB on disk) is refused 400 with a bomb message; the praser stays healthy afterwards.
## [2.0.0] - 2026-09-09
### Added
- The owner's two-web topology, engine-initiated: frontend + PDF praser live on one web (port-to-port), the engine is isolated; hidden→engine and engine→praser cross webs (https in prod).
- Engine-initiated handshake: a keyed `POST /fsm` delivery TRIGGERS the engine to connect to the praser (`PRASER_ENDPOINT`, default :5005) and PRESENT the delivered metadata at `POST /api/engine/collect`; the praser cross-checks it against the identity the uploader side bound and RESPONDS WITH THE TEXT once parsing finishes (404 = not ready yet → the engine waits, bounded by ENGINE_COLLECT_TIMEOUT_MS; 403 = misaligned → binding burned, no retry).
- Praser service (`module/api.py`): `POST /api/engine/bind` — the uploader side declares the minted identity ({submitId, filename, userId, sessionId, formId}) onto its job, once; `POST /api/engine/collect` — the engine presents, the response body IS the parsed text. One binding = one collect.
- Engine `GET /result/:hash` (keyed): the Site polls the collect outcome ({done, engineHash, syllableCount}).
### Changed
- NO binary is parsed in the Site server or the engine anymore: pythonPdf.js forwards the upload UNOPENED (multipart) to the praser service; the CLI is only spawned for the docx RESULT rewrite. The engine stages the collected text and reads it via readFromApi (FSM stream, \n-boundary yields).
- Site bridge: keyed /fsm delivery (+ textSha256/textBytes when the parsed text is in hand — the engine verifies the praser's response against them) then polls /result; the old /metadata declare + /process text-push are GONE. Engine /process is now keyed and srcPath-only.
### Notes
- userId is normalized to a string at the engine/praser boundary (dev-bypass userId is numeric).
- One collect per binding — tamper burns it (no chaining), matching the no-retry rule.
## [1.9.0] - 2026-09-09
### Added
- Engine `POST /fsm` — the endpoint hidden.js has been pointed at all along (FSM_ENDPOINT=http://localhost:9000/fsm). It is the ONLY record creator for the metadata cache and the ONLY keyed route: X-API-Key (root .env FSM_KEY/ENGINE_KEY) + caller-IP allowlist + origin allowlist, fail closed. Payload = hidden.js's exact shape (fileName, fileUrl, status, submitId, userId, sessionId, formId …); accepts a batch via `records`.
- Raw pull: /fsm with a fileUrl and no sha makes the ENGINE pull the raw txt from hidden's raw endpoint (same key) and compute the expected sha256/bytes from the authoritative file. /process also accepts an empty-text pull signal against a delivered fileUrl.
- Metadata cache holds ≥20 records (500 cap, TTL-bounded) delivered by hidden, exactly as designed.
### Changed
- `/metadata` and `/process` are now deliberately UNKEYED (the praser side has no key): calls are accepted blindly and the METADATA is the key — it is cross-checked against the hidden-delivered record. Misaligned or unknown → 403 and the record is BURNED (poisoned declares kill the record; one delivery authorises at most one push). The Site bridge performs the full dance: keyed /fsm delivery → blind declare → push.
### Notes
- hidden.js needed ZERO code changes — its existing payload to FSM_ENDPOINT is the /fsm contract.
- readFromApi.js is the engine's file-byte reader (FSM stream, \n-boundary yields) — used for every staged/pulled input; engine still never writes pdf/docx.
## [1.8.0] - 2026-09-09
### Added
- Engine handshake gate, fail closed: /metadata + /process require X-API-Key matching the root .env key (FSM_KEY / ENGINE_KEY, timing-safe compare), a caller IP on the allowlist, and — when the caller sends Origin/Referer — a host on the origin allowlist. An engine with NO key configured refuses everything. /health stays open (liveness).
- Allowlists: `ENGINE_ALLOWED_IPS` (explicit wins verbatim, even excluding loopback) and `ENGINE_ALLOWED_ORIGINS`. Dev placeholders in .env: origins `localhost:3000` etc.; IPs fall back to every `DEV_BYPASS_IP` entry + loopback. Boot banner prints key fingerprint + lists (never the key).
### Fixed
- IP allowlist no longer force-concats loopback when the operator sets an explicit ENGINE_ALLOWED_IPS — explicit config wins.
### Notes
- On the engine's read path: readFromApi's FSM stream (256 KB chunks) yields at \n boundaries by design — it never splits Burmese text mid-line; that reader was correct all along. The chunk-boundary corruption fixed in 1.7.0 was in the HTTP JSON body reader only; the sha/byte validators guard that path.
## [1.7.0] - 2026-09-09
### Added
- Engine pre-receive gate (`POST /metadata` on the engine api-server): the Site registers the submission's validators BEFORE any text crosses — the FRONTEND-created filename (`{submitId}{ext}`), userId and session-cookie identity (validators, not optional), formId, expected text sha256 + byte length. Body-text pushes must align with the record or are rejected (403) and the record is burned: one record authorises at most one push (replay dies).
- Rejection suite in `Tools/test/devbypass-roundtrip.sh` (10 cases: replay, no pre-receive, tampered sessionId/userId/filename/sha, malformed pre-receive).
### Changed
- Site bridge now sends `filename` + `{formId, userId, sessionId, source, originalName}` with every push; it refuses to push at all without the validators.
### Fixed
- Engine `readJson` decoded each TCP chunk separately — any multi-byte Burmese char split across a chunk boundary was silently corrupted in transit. The new sha/byte validators caught it on the 382 KB PDF push; buffers are now concatenated and decoded once.
- eslint globals: `URL`.
## [1.6.0] - 2026-09-09
### Added
- Site -> Private connection: parsed file text is pushed to the Engine (`POST /process`) with `hash: submitId`; Engine outputs land as `segmented_{submitId}_*.txt` so the server id is the join key. Decision on record: text goes in the request **body**, never as a file (readFromApi/invokeWithHash are engine-internal; `srcPath` is same-machine-only; deployments are separate).
- Engine result read-back via `invokeWithHash` (Module A -> readFromApi Module B) and, for .docx uploads, the result is re-written as `.output/docx/{submitId}.docx` (PRASER `write_docx_plain`, CLI accepts `.txt` input for the rewrite).
- `Tools/test/devbypass-roundtrip.sh` now covers the engine bridge (hash==submitId, docx rewrite).
### Changed
- Engine api-server forwards the caller's `hash` into the pipeline (previously always minted its own timestamp hash).
- /api/submit responses gain `{connected, engineHash, syllableCount[, docxPath]}`; engine failure degrades the upload, never blocks it.
### Fixed
- Engine could not boot in this repo: `mapper/idmapper.js` missing (restored from its reference copy), `DATA_DIR` still pointed at the private layout (now `Private/Engine/_knowledge/json`, per reference watch-out #1).
- eslint globals: `AbortSignal`.


## [1.5.0] - 2026-09-09
### Added
- .docx uploads parse server-side through the PRASER pipeline (detect → Rabbit → cleanup), same as .pdf — browser extraction could never fix the encoding.
- PRASER API `GET/POST /api/content` — one full text for a stored job; preview response now carries `content` (whole body, plain).
- PRASER CLI `--content` mode — prints only the document body to stdout (progress to stderr); the Node shell consumes it.
### Changed
- Every file upload on /api/submit parses server-side; the request `text` field is for plain-text submissions only.
- PRASER preview `changes` are plain original/suggested pairs — the server-rendered HTML diff (`<del>/<mark>`) is gone; highlighting is the client's job.
- DOCX jobs finalize to txt only (no layout kept); .doc still goes through antiword/catdoc.
### Fixed
- DEV_BYPASS_SESSION existed but nothing imported it — now actually wired into headerCheck, cookieGenerator, cookieDBCheck and the session store (MemoryStore, no DB); hard-off in production.
- Doubled repo-relative imports (`../../Site/Public/...`, `../../Private/...`) across Site/ crashed boot — fixed to real relative paths.
- Engine raw pull (`/api/hidden/raw/:submitId`) resolves the file from disk under the dev bypass so the seam is testable without MySQL.
