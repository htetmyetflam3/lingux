 |
# Project Structure — Lingux

Burmese grammar checker. Text or file in → extracted `.txt` → Engine analyses.
This file records **logic and owner corrections**, not code state — code may be
stubbed or unwired; the contracts below are what to trust. Read before grepping.

---

## Corrections — wrong assumptions agents make

- The API contract is request/response. Every seam in this project is a plain
  request-in / response-out call; ids travel inside the payload. No queues, no
  websockets, no special protocol — do not invent one.
- `Site/Server/gateway/proxy/` is **not an HTTP proxy**. It is the JS proxy
  pattern: intercept and delegate. `requestHandler`/`responseHandler` own no
  logic; they hand off to injected collaborators (`textHolder`, `metadataGuard`,
  `rawSaver`, `pool`). If you think HTTP before reading the code, you are
  misleading yourself.
- Site and Engine deploy separately. Their directory constants differ **on
  purpose** — bridge them, do not repoint them (Site writes `.output/txt` with
  the leading dot exactly because the Engine's constants read it).
- Engine output filenames must match what the server saved:
  `segmented_{hash}_raw_pos.txt` / `segmented_{hash}_syllable.txt`. The hash is
  the join key between the two halves.
- The engine hash (`YYYYMMDD_HHMMSS_mmm`, minted in `runMain()`) is not a
  server id. The server holds `visitorHash`/`userId` (sha256-32), `formId`,
  `submitId` (uuids). `hashKind()` validates shape; unknown shapes are refused.
- The Engine public API returns **positions, not segmented text**. The caller
  writes its own segmentation; positions are measured against the Engine's
  clean output, not the caller's raw text. Do not "fix" this.
- `curl` getting 403 is by design — it never visited the SPA, so it has no
  cookie row. The cookie row is written before bot validation on purpose: the
  row is how the visitor is known. Do not build threat models around curl.
- The daily quota is anti-spam for anonymous visitors (disk/CPU abuse,
  adversarial input), not billing. A paid tier later means a separate DB with
  accounts — not this gate.
- Parsing split: `.txt`/`.docx` are parsed **in the browser** (the client needs
  the text for in-browser grammar highlighting later; the server trusts a
  `text` field sent with the file and keeps the original in quarantine). `.doc`
  is server-side (antiword/catdoc). `.pdf` is server-only and currently unwired.
- `က္က` → `ဣ` in syllable output is **correct**. Pali does not stack `က္က`;
  it uses `ဣ`. Words showing `က္က` are Burmese Pali-style loanwords.
- The Engine does no linguistics with regex — table lookups + tree descent.
  Regex appears only in `tagger.js` (dates/phones/IDs) and build-time JSON
  streaming.
- Knowledge data is read encrypted (`master.json.enc` via `secure.js`). The
  plaintext copy at `Private/Syllable/mapper/map/master.json` should not be
  there — do not copy or commit plaintext data.
- `.env` is a placeholder — read `AGENT_NOTE` at its top. No security essays.
- Some seams are unwired **on purpose**. Ask before completing one.

---

## The four API surfaces — all request/response

| Surface | Where | Contract |
|---|---|---|
| Site | `Site/Server/gateway/api/` | `POST /api/submit` → `{formId, submitId, text, status}` · `POST/GET /api/result` → look up by formId + userId · `POST /api/process` (X-API-Key) pushes the submission metadata — **fileName included** — plus a pull URL to `FSM_ENDPOINT` · `GET /api/hidden/raw/:submitId` (X-API-Key) streams the saved `.txt` |
| Engine read | `Private/Engine/Ginit.js` (Module A) + `Private/Bridge/readFromApi.js` (Module B) | caller hands a hash → A builds the `segmented_{hash}_*.txt` name → B streams the file (256 KB chunks) and returns the text |
| Engine process | `Private/Syllable/api-server.js` | `POST /process` `{text \| srcPath, flags}` → Engine reads the input through its own stream reader, runs the pipeline, writes only in its own workspace → `{hash, syllable positions}` |
| Python PRASER | `Site/Public/PRASER/Python/module/api.py` | Flask: `GET /health` · `POST /api/preview` multipart pdf → `job_id` + cleanup changes · `POST /api/finalize` `job_id, apply, fmt` → download. Preview/finalize is the human-approval flow. Lacking: an endpoint that takes server metadata and returns one full text. No `client.py` exists. |

## Request path (Site)

```
POST /api/submit
  headerCheck → cookieDBCheck              (gates only on /api)
  checkQuota                               → 429
  createUploadSession                      → formId
  ├── client text present → trust it, quarantine the original
  └── no client text      → server parser (.txt / .pdf / .doc)
  chain: validate → textHolder → rawSaver → finalizeUpload
  incrementQuota
  → { formId, submitId, text, status:'pending' }
```

- `textHolder` (`gateway/text/content.js`) is the seam for request-carried text
  — use it, do not add parallel routines.
- `rawSaver` writes `.output/txt/{submitId}.txt` inside the PRASER project —
  both Site and Engine feed from there.

## Unwired seams — ask first

- `createParser()` accepts a `pdfParser` injection; nothing injects it yet, so
  a `.pdf` without client text throws. The PRASER Python extractor is the
  intended filler.
- `openFsmConnection()` (`gateway/generator/string.js`) is a stub: it receives
  the full metadata (formId, submitId, userId, sessionId, source,
  originalPath), returns `{connected:true}`, never reaches the Engine.
- Engine side: `invokeWithHash` must validate the hash name. Server side: must
  pass the saved `.txt` filename to the Engine. Neither is implemented.
- `incoming.js` no longer auto-pushes to FSM ("Playground no longer pushes to
  FSM"); `/api/process` is called externally with `FSM_KEY`.

## Directory map

| Path | What |
|---|---|
| `Site/index.js` | Express bootstrap: middleware order, multer, `/api` gate stack, route wiring |
| `Site/Server/cookie/` | cookie/session gates: `header.js`, `cgen.js`, `sanitized.js`, `codec.js`, `initialize.js` |
| `Site/Server/db/` | `db.js` pool, `request.js` quota + submission lifecycle, `session.js`, `cookie.js`, `schema.sql` |
| `Site/Server/gateway/api/` | `incoming.js` (submit), `outgoing.js` (result), `hidden.js` (FSM push/pull) |
| `Site/Server/gateway/proxy/` | `requestHandler.js`, `responseHandler.js` — JS-proxy interceptors |
| `Site/Server/gateway/text/` | `content.js` — the `textHolder` seam |
| `Site/Server/gateway/generator/` | `responses.js` (submitId + filename), `rawSaver.js`, `string.js` (encode + stub) |
| `Site/Public/_file/` | `paths.js` (all dir constants), `parser.js`, `saveOriginfile.js` |
| `Site/Public/PRASER/Python/` | PDF extractor; `module/api.py` Flask API, `module/prase.py` CLI / `--serve` |
| `Site/Public/STATIC/` | vite build lives here; built SPA served from `STATIC/frontend`; `Build/index.html` is the SPA, `page.html` is a different page (not wired) |
| `Private/Bridge/` | shared by both deployments: `path.js` (Engine constants), `readFromApi.js`, `logen.js`, `secure.js` |
| `Private/Engine/` | grammar pipeline, `Ginit.js` (Module A) |
| `Private/Syllable/` | segmenter, `api-server.js`, mapper |
| `Tools/` | `scripts.db` + `scrmgr.js` (stored utility scripts), `fix-import.js` (run from `Tools/`: `node fix-import.js ../Site/`), `build/`, `test/` |

Watch out: two `paths.js` (Site vs Engine constants), two HTML pages, two
deployments.

## Env flags (what the code actually reads)

| Flag | Effect |
|---|---|
| `SKIP_BUILD` | skip the vite build at boot (dev) |
| `PORT`, `API_PORT` | Site port, syllable api-server port |
| `SESSION_SECRET`, `COOKIE_SECRET` | session / cookie signing |
| `DB_HOST/PORT/USER/PASSWORD\|PASS/NAME` | MySQL pool |
| `DEV_BYPASS_QUOTA` | quota layer runs DB-free |
| `DEV_BYPASS_IP`, `DEV_BYPASS_HEADER` | skip cookie-DB upsert / header checks |
| `FSM_ENDPOINT`, `FSM_KEY` | `hidden.js` push target + key |
----

## Note
When you're asked to open a PR, feel free to write down the wrong assumptions you had before u make pr that needed correcting. Leave other agents some space — keep your descriptions minimal and let them get things wrong too. Don't try to make every mistake all by yourself. The content is bloated enough already: the very first agent covered almost every possible scenario. Thanks to him.

😉 KaungMyatThu
----