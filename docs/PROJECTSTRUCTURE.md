# Project Structure — Lingux

Read this **before** grepping. It exists so an agent joining this repo knows
where things are and, more importantly, which "obvious" assumptions are wrong
here.

---

## 1. What this project is

A **Burmese grammar checker**. A user submits text (typed, or a `.txt` /
`.docx` / `.pdf` / `.doc` upload), the text is extracted to a plain `.txt`, and
a grammar engine analyses it.

Three things make it unlike a generic upload-and-parse app:

**Burmese has an encoding civil war.** Two incompatible encodings share the
same code points: **Unicode** (correct) and **Zawgyi** (legacy, still
everywhere). The same bytes render as different words depending on which one a
document assumed. Nearly every "weird" piece of code in this repo exists
because of this, and any change that silently passes text through without
considering encoding is a bug even when the tests pass.

**PDFs cannot be trusted to report their own text.** A PDF stores glyph ids and
a font, not characters. Burmese PDFs routinely ship `ToUnicode` CMaps that map
those ids to Zawgyi lookalikes, so `pdf.js` returns *confident garbage*.
Measured on `test.pdf` (764 pages):

| extractor | first line | p(zawgyi) |
|---|---|---|
| pdf.js (browser) | `Chapter 701: ေကာငး့ကငးမီ့လြ္ဵတိုကးပျဲ` | 1.000 |
| PRASER (Python) | `Chapter 701: ကောင်းကင်မီးလျှံတိုက်ပွဲ` | 0.000 |

The Python extractor reads the **embedded TTF cmap** instead of the CMaps,
which is the only authoritative source. This is why PDF parsing was *removed*
from the browser — see §5.

**Site and Engine deploy separately.** They live in one repo but ship as two
independent deployments. Directory constants that look "inconsistent" between
them are correct — **do not "fix" them to point at each other**.

---

## 2. Top-level map

| Path | What it is |
|---|---|
| `Site/` | The web app: Express server, frontend, upload pipeline. Deploys on its own. |
| `Private/` | The grammar **Engine** and shared bridge/logging. Deploys on its own. |
| `Tools/` | Developer/agent tooling: build scripts, reusable tests, the script library. **Put your scripts here.** |
| `docs/` | This file, `AGENTS.md`, build map, licence. |
| `eslint.config.js` | Flat config. Needs `@eslint/js` (see §7). |
| `package.json` | Workspace root, `name: fsmgr-root`. Version bumped per PR. |

---

## 3. `Site/` — the web app

```
Site/
├── index.js                    Express bootstrap: middleware order, multer,
│                               SQL logging, HTTP logging, route wiring, listen
├── Server/
│   ├── cookie/                 The three request gates (order matters)
│   │   ├── header.js           gate 1 — bot User-Agent + country + IP checks
│   │   ├── cgen.js             gate 2 — cookie generation, visitor upsert
│   │   ├── sanitized.js        gate 3 — cookie/session validation → req.userId
│   │   ├── codec.js            cookie encode/decode
│   │   ├── initialize.js       session setup
│   │   └── devbypass.js        OPTIONAL dev-only bypass module (see §6)
│   ├── db/
│   │   ├── db.js               mysql2 pool
│   │   ├── request.js          quota + submission lifecycle (see below)
│   │   ├── cookie.js           visitor row upsert
│   │   ├── session.js          session store
│   │   ├── sqlLog.js           wraps pool.query AND pool.getConnection
│   │   └── schema.sql          table definitions
│   ├── gateway/
│   │   ├── api/
│   │   │   ├── incoming.js     POST /api/submit — the whole upload path
│   │   │   ├── outgoing.js     GET /api/quota, POST/GET /api/result
│   │   │   └── hidden.js       /api/process, /api/hidden/raw/:submitId
│   │   ├── proxy/
│   │   │   ├── requestHandler.js   the submit chain + THE SAVE GATE
│   │   │   ├── responseHandler.js  result lookup
│   │   │   └── jobs.js             background extraction registry
│   │   ├── generator/
│   │   │   ├── rawSaver.js     writes the parsed .txt to disk
│   │   │   ├── responses.js    response shapes
│   │   │   └── string.js       id/filename helpers
│   │   └── text/content.js     text holder
│   └── log/httpLog.js          Morgan rendered in the engine's palette
└── Public/
    ├── _file/                  file handling, shared by server code
    │   ├── paths.js            ALL directory constants live here
    │   ├── magic.js            magic-byte validation + upload limits
    │   ├── parser.js           dispatch by extension → the right parser
    │   ├── pythonPdf.js        bridge to the PRASER Python extractor
    │   └── saveOriginfile.js   quarantine copy of the original upload
    ├── PRASER/Python/          the PDF extractor (stdlib only, no pip deps)
    │   ├── module/prase.py     CLI entry: prase.py <in.pdf> <out.txt>
    │   ├── module/pipeline.py  page streaming
    │   ├── module/fonts.py     embedded TTF cmap parsing ← the authority
    │   ├── module/detector.py  Zawgyi/Unicode detection
    │   ├── module/rabbit.py    Zawgyi↔Unicode conversion
    │   ├── upload/input/       multer's destination, sorted by type
    │   ├── upload/quarantine/  original-file copies (auto-created)
    │   └── .output/            generated txt + originals (gitignored)
    └── STATIC/Build/
        ├── index.html          THE SPA that main.js drives
        ├── page.html           a DIFFERENT marketing page — not wired to main.js
        └── js/main.js          client: file handling, submit, polling, quota badge
```

### The request path, in order

```
POST /api/submit
  headerCheck            bot UA / country / IP
  cookieDBCheck          cookie + session → req.userId
  multer                 limits (10MB, 1 file) + extension allowlist
  magic.js               bytes must match the extension        → 415
  checkQuota             read-only                             → 429
  createUploadSession    mints formId
  ├── client text (.txt/.docx)  → synchronous, respond with the text
  └── no client text (.pdf/.doc) → jobs.start(), respond 202 "extracting"
        parser → rawSaver writes .txt → commitSubmission   ← THE SAVE GATE
```

**The save gate** (`requestHandler.js`) is the single place a submission is
recorded and quota is charged: the instant the `.txt` exists on disk, in one
transaction (`UPDATE submissions` + `UPDATE users +1`). Earlier would bill for
work that may still fail; later would give away a saved artifact. Do not add a
second charge point.

---

## 4. `Private/` — the Engine

```
Private/
├── Bridge/
│   ├── logen.js        the logger. Owns the colour palette + module badges.
│   │                   Exports palette/moduleBadges/statusColors/stamp so the
│   │                   Site can print in the same style. Additive only.
│   ├── bridge.js       syllable bridge
│   ├── path.js         Engine paths (NOT the Site's paths.js)
│   └── readable.js     readability pass
├── Engine/             grammar: _pos, _clauses, _sentences, _knowledge
└── Syllable/           segmentation: builder, mapper, helper, main
```

`Private/Bridge/logen.js` is imported by **both** deployments. Treat changes as
cross-cutting: add exports, don't alter existing behaviour.

---

## 5. Parsing rules (decided, not up for rediscovery)

| Format | Parsed where | Why |
|---|---|---|
| `.txt` | browser (`file.text()`) | trivial, and the client needs the text for future in-browser grammar highlighting |
| `.docx` | browser (mammoth, CDN) — server (mammoth) as fallback | zip of XML; safe client-side |
| `.pdf` | **server only** (PRASER/Python) | browser output is Zawgyi garbage — see §1 |
| `.doc` | server (antiword/catdoc) | binary OLE2 |

The server **ignores** any `text` field sent alongside a `.pdf`. A PDF is
always re-extracted server-side.

---

## 6. Things that look like bugs but are not

- **curl gets 403.** The bot User-Agent block is deliberate. `devbypass.js`
  opens it for agents; it is an **optional module** — delete the file and the
  app still boots with the gate enforced. `DEV_BYPASS_IP` /
  `DEV_BYPASS_HEADER` / `DEV_BYPASS_QUOTA` are independent of it and read
  `process.env` directly.
- **`/api/submit` returns 202 immediately.** Intended. The design is
  hash/token driven; the client polls `POST /api/result` with the `formId`.
- **`GET /` 404s in dev.** The built frontend is not present unless you run the
  Vite build; use `SKIP_BUILD=true`.
- **Divergent directory constants between Site and Engine.** They deploy
  separately. Leave them.
- **Unwired seams exist on purpose.** Ask before "completing" one.

---

## 7. Testing realities

**The production MySQL is unreachable from dev boxes and sandboxes.**
`srv1415.hstgr.io` whitelists IPs. Without `DEV_BYPASS_QUOTA=true`, every
request dies at the first DB call with `PROTOCOL_CONNECTION_LOST` — this is
environmental, not a code fault. Consequences:

- HTTP tests must run with the dev bypasses on.
- Anything DB-shaped must be tested against a **fake pool**
  (`Tools/test/db-contract.test.mjs` shows the pattern). A fake pool is also
  the only way to assert "this function performed zero writes" or "the
  transaction rolled back".
- mysql2 returns `DATE` columns as JS `Date` objects. Fixtures using strings
  will pass for the wrong reason or crash.

**Start the server for HTTP tests:**

```bash
SKIP_BUILD=true node Site/index.js      # buildClient() exits(1) without this
```

**Run the suites:**

```bash
node Tools/test/db-contract.test.mjs    # no server, no DB needed
bash Tools/test/http-e2e.test.sh        # needs the server running
```

**Lint** needs `@eslint/js`, which is not always installed:

```bash
npm install --no-save --no-package-lock @eslint/js eslint
node node_modules/eslint/bin/eslint.js <files>
```

---

## 8. `Tools/` — read this before writing a script

| Path | What |
|---|---|
| `Tools/scripts.db` | **SQLite library of 63 utility scripts** + Burmese linguistic data. Look here before writing anything new. |
| `Tools/scrmgr.js` | CLI for that database. |
| `Tools/fix-import.js` | Repairs broken relative imports. Run as `node fix-import.js ../Site/Server/` **from inside `Tools/`**. |
| `Tools/build/` | Build artifacts and pipelines: `build.js`, `bundler.js`, `build-bytecode.js`, `obfuscate-map.js`, `encrypt-data.js`, `decrypt-data.js`. |
| `Tools/test/` | **Reusable test scripts. Put yours here** — not in `/tmp`. |
| `Tools/git.sh`, `gitinit.sh`, `codespace.sh` | Environment helpers. |

### Using the script library

```bash
node Tools/scrmgr.js list                      # everything
node Tools/scrmgr.js info <category|file>      # details
node Tools/scrmgr.js exe <filename> [args...]  # run one
node Tools/scrmgr.js sav <file> [category] [description...]   # store one
node Tools/scrmgr.js export <filename|all>     # write to disk
```

Categories: `tform` (7), `build` (14), `clean` (13), `utilities` (8), `map` (4),
`segment` (4), `id` (3), `scan` (2), `fix` (2), `algorithm` (2), `report`,
`config`, `db`, `store`, `algo`.

`scripts.db` also holds project data an agent may need instead of regenerating
it: `burmese_syllables` (2,251), `syllables` (3,214), `pali_syllables` (717),
`mmgrammar` (66 grammar articles), `master_json`.

---

## 9. Environment flags

| Flag | Effect |
|---|---|
| `SKIP_BUILD=true` | Skip the Vite build at boot. Required in dev. |
| `DEV_BYPASS_QUOTA` | Quota layer runs DB-free. |
| `DEV_BYPASS_IP` | Requests from this IP skip the cookie DB upsert. Duplicate lines in `.env` — dotenv keeps the **last**. |
| `DEV_BYPASS_HEADER` | Skip country/header checks. |
| `DEV_BYPASS_SESSION` | Opens the bot-UA + cookie-row gates. Needs `devbypass.js`. Inert when `NODE_ENV=production`. |
| `FREE_DAILY_QUOTA` | Daily submissions per anonymous visitor (default 3). Anti-spam, not billing. |
| `EXTRACT_CONCURRENCY` | Max simultaneous Python extractions (default 2). |
| `EXTRACT_TTL_MS` | How long a finished job stays collectable (default 600000). |
| `PYTHON_BIN`, `PRASER_TIMEOUT_MS`, `PRASER_CLEANUP` | PDF extractor controls. |
| `NO_COLOR` | Plain HTTP log lines. |
