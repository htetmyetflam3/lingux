.# Changelog

All notable changes to this project will be documented here. !Do not write minor changes and  changes that  doesnt effect original behaviour.
Format follows [Keep a Changelog](https://keepachangelog.com/); this project
uses [Semantic Versioning](https://semver.org/).


## Version  1.4.0






---

*Note* : **"previous changelog arent registerd here .so start registering fron 1.4.0"**


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