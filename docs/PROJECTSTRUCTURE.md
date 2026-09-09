 |
# Project Structure — Lingux


This file records **logic and owner corrections**, not code state — code may be
stubbed or unwired; the contracts below are what to trust. Read before grepping scroll to the button and read the  note twice  after that feel free to include any lines inside this file as part of commit.
---




## Corrections — wrong assumptions agents make
`````
This file here isnt intended to serve 
as system description and technical 
explanations . We all know what
everyone else does.so this is a file  to describe everyone else might assume wrongly without reading carefully , considering base  on  typical file name ,workflow and any other  missmatch case for people who  will touch  code after you ur allow to delete if the  missmatch cases  doesn't  not exist  anymore 
Append the content by only writing 
below this line
````````









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
- Parsing split: every FILE upload is parsed **server-side** now — .pdf and
  .docx through PRASER (the Python side does the Zawgyi→Unicode encoding work
  browser extractors can't), .doc via antiword/catdoc, .txt read from disk.
  The request `text` field is for plain-text submissions only.
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
- PRASER API output shape: preview carries `content` (whole body, one plain
  text, no banner/markers/HTML); `changes` are plain original/suggested pairs
  (no `html` field); `/api/content` returns one full text; docx jobs finalize
  txt-only. The Node side consumes the CLI `--content` mode (same shape).
- DEV_BYPASS_SESSION was written but never imported — it is wired into the
  gates now (headerCheck, cookieGenerator, cookieDBCheck, session store, and
  the raw-pull disk fallback). Flag off = gates enforced; with the flag off
  the global cookieGenerator still needs the DB (500 without it) — pre-existing.
- Site/ files carried doubled repo-relative imports (`../../Site/Public/...`,
  `../../Private/...`) from the restructure; fixed to the real relative
  paths. Do not reintroduce root-style paths inside Site/.
- Site -> Engine transport is the request BODY (`{text, hash}` to the engine
  api-server), not a file. readFromApi/invokeWithHash are the ENGINE's
  internal read path (engine cwd); `srcPath` is same-machine-only; the
  deployments are separate. `hash` = the Site's submitId (uuid passes
  hashKind) -> outputs land as `segmented_{submitId}_*.txt`.
- The engine api-server must run with the repo root as cwd (OutputFile()/
  DataFile() resolve against cwd); the Site reads results back via the
  same-repo invokeWithHash import. Cross-deployment that read becomes an
  HTTP pull — not wired, do not assume it.
- runMain() resets the engine workspace every call: only the newest engine
  result exists at a time; the Site reads it synchronously in the request.
- Engine push is a two-step validator, no chaining: metadata pre-receive
  first (engine `POST /metadata`), then the text (`POST /process`). The
  filename is the FRONTEND-created `{submitId}{ext}`; userId + session
  cookie identity are validators, not optional. A push that misses or
  misaligns any validator (filename, userId, sessionId, textSha256,
  textBytes) is rejected 403 and the record is burned — one pre-receive
  authorises at most one push. The Python PRASER never calls the engine.
- READER'S LENS on the rows below: this Corrections log is append-only,
  so it records the whole journey. Rows describing engine `POST
  /metadata` declares, body-text pushes, /fsm raw pulls or the hidden
  raw-endpoint fileUrl are HISTORICAL iterations (v1.7.0-v1.9.0). The
  CURRENT contract (v2.0.0+) is ONLY: keyed hidden delivery (`POST
  /fsm`) -> engine-initiated collect from the praser
  (`/api/engine/collect`, uploader bound via `/api/engine/bind`) ->
  keyed `GET /result/:hash` poll -> invokeWithHash read-back. There is
  no engine /metadata route anymore.
- Bomb armor (v2.1.0): the praser is the only component that opens
  containers, so it carries the caps — PDF FlateDecode streams capped
  (PRASER_MAX_STREAM_MB), docx members capped by size AND compression
  ratio (PRASER_MAX_MEMBER_MB, 200x), upload door caps at both the
  praser (PRASER_MAX_UPLOAD_MB) and the Site (UPLOAD_MAX_MB). A cap hit
  refuses the document (400) — never a silent empty text.
- Two-web topology (owner design, v2.0.0): frontend + PDF praser on one
  web (port-to-port), engine isolated. The ENGINE initiates every
  cross-web connection: keyed /fsm delivery triggers an outbound
  handshake to the praser (PRASER_ENDPOINT, /api/engine/collect) which
  cross-checks the presented metadata against the uploader-side binding
  (/api/engine/bind, made by incoming.js after the identity is minted)
  and RESPONDS WITH THE TEXT once parsing finishes. Binaries are only
  ever touched by the praser service — the Site forwards uploads
  unopened, the engine never sees them. Site polls keyed
  GET /result/:hash; invokeWithHash stays the read-back.
- Endpoint split (owner design): the KEY guards hidden.js → engine
  (`POST /fsm` — the ONLY record creator; payload = hidden.js's exact
  shape, FSM_ENDPOINT already pointed there). The praser side
  (`/metadata`, `/process`) is UNKEYED by design — accepted blindly and
  validated by CROSS-CHECKING its declared metadata against the cache
  hidden delivered (≥20 records, TTL). Misaligned → 403 + record
  burned. Pull mode: /fsm with fileUrl (no sha) makes the engine pull
  the raw txt from hidden's raw endpoint and compute the expected
  sha/bytes itself; /process accepts an empty-text pull signal.
- The engine handshake is gated too (key + IP + origin, fail closed):
  X-API-Key must match the root .env FSM_KEY/ENGINE_KEY, the caller IP must
  be allow-listed (explicit ENGINE_ALLOWED_IPS wins verbatim; default =
  DEV_BYPASS_IP entries + loopback), and any Origin/Referer must resolve to
  an ENGINE_ALLOWED_ORIGINS host (dev placeholder localhost:3000). /health
  is the only open route.
- readFromApi's FSM stream yields at \n boundaries by design — 256 KB
  chunks, never splitting Burmese mid-line. That reader was correct all
  along; the 1.7.0 corruption was in the HTTP JSON reader (per-chunk
  decode). Do not "fix" the stream.

---

## The four API surfaces — all request/response

| Surface | Where | Contract |
|---|---|---|
| Site | `Site/Server/gateway/api/` | `POST /api/submit` → `{formId, submitId, text, status}` · `POST/GET /api/result` → look up by formId + userId · `POST /api/process` (X-API-Key) pushes the submission metadata — **fileName included** — plus a pull URL to `FSM_ENDPOINT` · `GET /api/hidden/raw/:submitId` (X-API-Key) streams the saved `.txt` |
| Engine read | `Private/Engine/Ginit.js` (Module A) + `Private/Bridge/readFromApi.js` (Module B) | caller hands a hash → A builds the `segmented_{hash}_*.txt` name → B streams the file (256 KB chunks) and returns the text |
| Engine process | `Private/Syllable/api-server.js` | `POST /process` `{text \| srcPath, hash?, flags}` → Engine reads the input through its own stream reader, runs the pipeline, writes only in its own workspace → `{hash, syllable positions}`. `hash` (optional) = caller id (uuid passes `hashKind`) → outputs named `segmented_{hash}_*` |
| Python PRASER | `Site/Public/PRASER/Python/module/api.py` | Flask: `GET /health` · `POST /api/preview` multipart pdf/docx → `job_id` + `content` (whole body, plain) + cleanup changes · `GET/POST /api/content` `job_id, apply` → one full text · `POST /api/finalize` `job_id, apply, fmt` → download (docx jobs: txt only). Preview/finalize is the human-approval flow. |

## Request path (Site)

```
POST /api/submit
  headerCheck → cookieDBCheck              (gates only on /api)
  checkQuota                               → 429
  createUploadSession                      → formId
  ├── file present → server parser (.pdf/.docx via PRASER, .doc antiword, .txt read)
  └── no file      → trust req.body.text
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
- The real Site -> Engine connection is `generator/engine.js`
  (`createEngineBridge`), wired into `incoming.js` after the raw save —
  file submissions only. `openFsmConnection()` (`generator/string.js`) is
  still the legacy Encoding-flow stub; do not confuse the two.
- Engine side: `invokeWithHash` validates shapes via `hashKind` (done);
  cross-deployment result pull over HTTP is NOT implemented.
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
| `DEV_BYPASS_SESSION` | opens the cookie/session gates for curl-style clients; MemoryStore sessions, raw-pull disk fallback. Hard-off when `NODE_ENV=production` |
| `PYTHON_BIN`, `PRASER_TIMEOUT_MS`, `PRASER_CLEANUP` | the PRASER shell's python binary / exec timeout / cleanup default |
| `FSM_ENDPOINT`, `FSM_KEY` | `hidden.js` push target + key |
| `ENGINE_ENDPOINT`, `ENGINE_KEY`, `ENGINE_TIMEOUT_MS` | the engine api-server the Site pushes parsed file text to (key falls back to `FSM_KEY`) |
----

## Note
When you're asked to open a PR, feel free to write down the wrong assumptions you had before u make pr that needed correcting. Leave other agents some space — keep your descriptions minimal and let them get things wrong too. Don't try to make every mistake all by yourself. The content is bloated enough already: the very first agent covered almost every possible scenario. Thanks to him.

😉 KaungMyatThu
----