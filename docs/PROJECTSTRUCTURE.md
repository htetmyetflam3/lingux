# Project Structure — Lingux

Burmese grammar checker. User submits text or a file → text is extracted to a
plain `.txt` → the Engine analyses it.

Read this before grepping. It is mostly a list of things you will get **wrong**
by assuming.

---

## 1. Corrections

Wrong guesses, already corrected by the owner. Add to this list, keep it flat.

- The API is a token contract, not typical request/response.
- The client gets a token and polls. `/api/submit` answering 202 before the
  work is done is intended, not a loose end.
- The token is not `formId`, `submitId` or `visitorHash`. It derives from
  session id + cookie + user id, plus a timestamp.
- The filename carries the timestamp and prevents collisions across files and
  users. The Engine output filename must match the frontend-saved `.txt` name.
- Site and Engine deploy separately. Directory constants differing between them
  are correct — do not repoint them.
- The curl/bot 403 is the design. Do not build threat models around curl; it is
  a testing path only.
- `.txt`/`.docx` stay browser-parsed because the client needs the text for
  in-browser grammar highlighting later. Only `.pdf` is server-only.
- The daily limit is anti-spam for anonymous visitors, not a billing plan. The
  gates exist to stop disk dumping and adversarial input (e.g. a 20,000-char
  tail like `နော` + `းးးး…`), not to monetise.
- `က္က` → `ဣ` in the syllable output is **correct**, not a bug. Pali does not
  stack `က္က`; it uses `ဣ`. Words showing `က္က` (e.g. `ကုက္ကိုပင်`) are
  Burmese Pali-style loanwords, not actual Pali.
- The Engine does no Burmese linguistics with regex. The segmenter/walkers are
  table lookups + tree descent, which is why a long-tail input that would
  backtrack a regex engine to death runs in ~0.5s here. Regex appears only in
  `tagger.js` (dates/phones/IDs) and build-time JSON streaming.
- `master.json` is now `master.json.enc`; `readSecureText/readSecureJson`
  handle it. The Engine expects its own deployment layout (`ENGINE/Part/...`),
  which does not exist in this repo — bridge it, do not repoint the constants.
- `.env` is a placeholder, not a leak — read `AGENT_NOTE` at the top of it.
  No security essays.
- Some seams are unwired on purpose. Ask before completing one.

---

## 2. Not implemented yet

Raised in chat, never finished. Do not guess additions.

- `invokeWithHash` (Engine side) must validate the token hash name.
- The server does not pass the parsed `.txt` filename to the Engine. The two
  halves are not joined.
- Token derivation (session id + cookie + user id + timestamp) is designed, not
  built.
- Paid tier: separate DB with user login and accounts, replacing the anonymous
  session/quota token. Free tier keeps the daily anti-spam limit.
- In-browser grammar highlighting from the client-side text.
- `finalizeUpload()` and `incrementQuota()` have no callers since the save gate
  landed. Owner decided to keep them; `commitSubmission()` is the only path
  that should be called.

---

## 3. Burmese encoding — the recurring bug source

Two incompatible encodings share code points: **Unicode** (correct) and
**Zawgyi** (legacy, everywhere). Same bytes, different words.

A PDF stores glyph ids and a font, not characters. Burmese PDFs ship
`ToUnicode` CMaps pointing at Zawgyi lookalikes, so **pdf.js returns confident
garbage**. On `test.pdf` (764 pages): pdf.js → p(zawgyi)=1.000, PRASER Python →
0.000. Only the embedded TTF cmap is authoritative.

Anything touching Burmese text must be encoding-aware.

---

## 4. Parsing split (decided)

| Format | Parsed | Why |
|---|---|---|
| `.txt`, `.docx` | **browser** | client needs the text for future in-browser grammar highlighting |
| `.pdf` | **server only** | browser output is Zawgyi garbage |
| `.doc` | server | binary OLE2 |

The server ignores a `text` field sent with a `.pdf`.

---

## 5. Request path

```
POST /api/submit
  headerCheck        bot UA / country / IP        → 403
  cookieDBCheck      cookie + session → req.userId
  multer             10MB, 1 file, extension allowlist  → 413/415
  magic.js           bytes must match extension   → 415
  checkQuota         read-only                    → 429
  createUploadSession → formId
  ├── client text   → synchronous, respond with text
  └── no client text → 202 "extracting", job runs in background
        parser → rawSaver writes .txt → commitSubmission   ← SAVE GATE
```

**The save gate is the only place quota is charged** — the instant the `.txt`
hits disk, in one transaction with the submission row. Do not add a second
charge point.

Quota (`FREE_DAILY_QUOTA`, default 3) is **anti-spam for anonymous visitors**,
not a billing plan. A paid tier with real accounts is planned separately.

---

## 6. Directory map

| Path | What |
|---|---|
| `Site/index.js` | Express bootstrap: middleware order, multer, logging, routes |
| `Site/Server/cookie/` | the 3 gates: `header.js` → `cgen.js` → `sanitized.js`; `devbypass.js` optional |
| `Site/Server/db/` | `request.js` (quota + submission lifecycle), `sqlLog.js`, `schema.sql` |
| `Site/Server/gateway/api/` | `incoming.js` (submit), `outgoing.js` (quota/result), `hidden.js` |
| `Site/Server/gateway/proxy/` | `requestHandler.js` (save gate), `jobs.js` (background extraction) |
| `Site/Server/gateway/generator/` | `rawSaver.js` writes the parsed `.txt` |
| `Site/Server/log/httpLog.js` | Morgan in logen's palette |
| `Site/Public/_file/` | `paths.js` (all dir constants), `magic.js`, `parser.js`, `pythonPdf.js` |
| `Site/Public/PRASER/Python/` | the PDF extractor, stdlib only. `module/prase.py` is the CLI |
| `Site/Public/STATIC/Build/` | `index.html` = **the SPA**; `page.html` = a different page, not wired |
| `Private/Bridge/logen.js` | logger + colour palette. Imported by **both** deployments |
| `Private/Engine/`, `Private/Syllable/` | grammar and segmentation |
| `Tools/` | see §7 |

Watch out: two `paths.js` (Site and Engine), two HTML pages, two deployments.

---

## 7. Testing realities

**The production MySQL is unreachable from sandboxed dev environments.** The
credentials and the server are fine — they connect from a normal machine. A
proxy inside the sandbox accepts every TCP socket (even to closed ports and
unroutable addresses) but relays only HTTP, so the MySQL handshake dies as
`PROTOCOL_CONNECTION_LOST`. Without `DEV_BYPASS_QUOTA=true` every request dies
at the first DB call. Environmental, not a bug — and not a server-side block.

- HTTP tests need the dev bypasses on.
- DB code must be tested with a **fake pool** — also the only way to assert
  "zero writes" or "rolled back".
- mysql2 returns `DATE` columns as `Date` objects; string fixtures lie.
- `curl` gets 403 by design. `devbypass.js` opens it for agents and is
  **optional** — delete the file and the gate stays enforced.

```bash
SKIP_BUILD=true node Site/index.js     # buildClient() exits(1) without this
node Tools/test/db-contract.test.mjs   # no server, no DB
bash Tools/test/http-e2e.test.sh       # needs the server
```

Lint needs `@eslint/js`, often missing:
`npm install --no-save --no-package-lock @eslint/js eslint`

---

## 8. Tools — look here before writing anything

| Path | What |
|---|---|
| `Tools/scripts.db` | SQLite: **63 utility scripts** + Burmese data (`syllables` 3214, `burmese_syllables` 2251, `pali_syllables` 717, `mmgrammar` 66) |
| `Tools/scrmgr.js` | CLI for it: `list`, `info <cat\|file>`, `exe <file>`, `sav`, `export` |
| `Tools/fix-import.js` | fixes broken imports — run `node fix-import.js ../Site/Server/` **from `Tools/`** |
| `Tools/build/` | build, bundle, bytecode, obfuscate, encrypt |
| `Tools/test/` | reusable tests — **put yours here, not `/tmp`** |

---

## 9. Env flags

| Flag | Effect |
|---|---|
| `SKIP_BUILD` | skip the Vite build at boot (required in dev) |
| `DEV_BYPASS_QUOTA` | quota layer runs DB-free |
| `DEV_BYPASS_IP` | this IP skips the cookie DB upsert (**duplicate lines in `.env` — dotenv keeps the last**) |
| `DEV_BYPASS_HEADER` | skip country/header checks |
| `DEV_BYPASS_SESSION` | opens bot-UA + cookie-row gates; needs `devbypass.js`; inert in production |
| `FREE_DAILY_QUOTA` | daily submissions per visitor (3) |
| `EXTRACT_CONCURRENCY` / `EXTRACT_TTL_MS` | background extraction limits (2 / 10min) |
| `PYTHON_BIN`, `PRASER_TIMEOUT_MS`, `PRASER_CLEANUP` | PDF extractor |
| `NO_COLOR` | plain HTTP logs |
