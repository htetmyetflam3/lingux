.# Changelog

All notable changes to this project will be documented here. !Do not write minor changes and  changes that  doesnt effect original behaviour.
Format follows [Keep a Changelog](https://keepachangelog.com/); this project
uses [Semantic Versioning](https://semver.org/).


## Version  1.4.0






---

*Note* : **"previous changelog arent registerd here .so start registering fron 1.4.0"**


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