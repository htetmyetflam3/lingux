# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); this project
uses [Semantic Versioning](https://semver.org/).

---

## [1.4.0] - 2026-09-08

Server-side PDF extraction, upload validation, and a submit route that no
longer blocks on parsing.

### Added

- **PDF text is now extracted server-side** by the PRASER Python tool
  (`Public/_file/pythonPdf.js`), filling the parser slot that previously threw
  `PDF parser not configured`. A 764-page book extracts in ~2s with zero Zawgyi
  code points, where the browser's pdf.js returned p(zawgyi)=1.000 on the same
  file.
- **Magic-byte validation** (`Public/_file/magic.js`) — an upload's bytes must
  match its extension. Rejects a renamed file with 415 before anything parses
  it. This is the check neither multer nor mammoth performs.
- **Background extraction jobs** (`Server/gateway/proxy/jobs.js`) with a
  concurrency cap, so a server-parsed upload answers immediately and the client
  collects the text by polling the `formId` it already had.
- **Server-side `.docx` parsing** via mammoth, for clients that cannot run it
  in a browser.
- `GET /api/quota` — read-only quota status, so the Check button knows the
  answer before a user commits a file.
- `POST /api/result` now reports extraction stages: `202 extracting`,
  `200 extracted` (text + charged quota), `422` terminal failure with a reason.
- **HTTP access log rendered in the engine's palette**
  (`Server/log/httpLog.js`) — badge, timestamp and level column now match
  every other line the system prints. `NO_COLOR` supported; the file log stays
  plain `combined`.
- `Tools/test/http-e2e.test.sh` and `Tools/test/db-contract.test.mjs` —
  reusable suites (22 and 26 checks).
- `docs/PROJECTSTRUCTURE.md` and `docs/AGENTS.md`.
- Env knobs: `FREE_DAILY_QUOTA`, `EXTRACT_CONCURRENCY`, `EXTRACT_TTL_MS`,
  `PYTHON_BIN`, `PRASER_TIMEOUT_MS`, `PRASER_CLEANUP`.

### Changed

- **Quota is charged at exactly one point** — the moment the parsed `.txt`
  reaches disk — instead of before parsing. Nobody is billed for work that
  fails.
- **The submission row and the quota charge are now one transaction**
  (`commitSubmission`), so a half-recorded submission cannot exist.
- **`POST /api/submit` returns in ~27ms for a 764-page PDF** (was ~1842ms).
  Extraction runs behind the returned token.
- Submit responses carry the current quota, so the UI updates without a second
  round trip; 429 rejections carry it too.
- Multer now enforces `limits` (10 MB, one file) and an extension allowlist,
  and its errors return JSON instead of an HTML 500.
- `Private/Bridge/logen.js` exports its palette, badges and timestamp
  (additive only) so the Site can reuse them rather than duplicate them.
- `devbypass.js` is now an **optional module**: delete the file and the app
  boots with the gate enforced. `DEV_BYPASS_IP` / `_HEADER` / `_QUOTA` keep
  their original behaviour without it.

### Fixed

- **SQL logging missed every transaction.** `pool.query` was wrapped but
  `pool.getConnection` was not, so the submission+quota transaction — the most
  consequential write in the system — never reached the log. Both doors are now
  covered, with per-transaction tags.
- A `.pdf` submitted with a client-supplied `text` field no longer trusts that
  text; PDFs are always re-extracted server-side.

### Removed

- **PDF parsing in the browser.** `extractPdf()` and the pdf.js CDN loads are
  gone from `main.js` and `index.html`. `.txt` and `.docx` keep browser
  parsing; PDFs upload raw.

---

## [1.3.0] and earlier

Not tracked in this file — this changelog starts at 1.4.0.
