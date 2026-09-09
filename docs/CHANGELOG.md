.# Changelog

All notable changes to this project will be documented here. !Do not write minor changes and  changes that  doesnt effect original behaviour.
Format follows [Keep a Changelog](https://keepachangelog.com/); this project
uses [Semantic Versioning](https://semver.org/).


## Version  1.4.0






---

*Note* : **"previous changelog arent registerd here .so start registering fron 1.4.0"**


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