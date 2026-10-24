# REORG-NOTES — scattered-module reorg, working memory

Persistent notes for the lingux reorganization. Each entry records what was
found in the source repos/branches and the coupling points later tasks must
rewire. Nothing here is a task list to execute blindly — follow the owner's
per-turn instructions.

Source repos (shallow clones used during exploration; GitHub is source of truth):

- `htetmyetflam3/linga` — branches are standalone. Relevant here:
  - `site` — the Site (express backend + two frontends), newer **queue** engine contract
  - `dev` — standalone Engine sketch (FSM api-server) + an older Site, older **FSM** contract
  - `architecture` — engine-only layout; its `Bridge/` is blob-identical to `dev`'s `Bridge/`
- `htetmyetflam3/scraper` — full copy now under `Scraper/`; carries its own embedded `Engine/` and `wasm/box`
- `htetmyetflam3/proofreading` — full copy now under `Proofreading/`; carries embedded `Engine/` and `scraper/`

---

## 1. Current lingux layout state (2026-10-24)

| Dir | State | Contents |
|---|---|---|
| `Site/` | populated from linga `site` | `Backend/` (57 files), `Frontend/` (165 files, incl. committed `dist/`), `index.js` — blob-verified |
| `Scraper/` | full scraper repo @ main (160 files) | crawler, wasm, ocr_runtime, praser, embedded `Engine/` |
| `Proofreading/` | full proofreading repo @ main (232 files) | mt, format, content, tools, embedded `Engine/`, embedded `scraper/` |
| `Engine_host/` | partial | `Bind/` (= engine Bridge layer, see §4), `Lexical_No_inspect/`, empty `index.js`; **no MonoSyllabism yet** |
| `Parser_host/` | **empty placeholder** | future home of the parser currently embedded via the Site backend |
| `Bridge/` | empty placeholder (`gitkeep`) | owner-defined: interjection/wiring code *between* architectures, not a module copied from any repo |

Root `package.json` already assumes `Site/index.js` (`dev: nodemon Site/index.js`).
No `package.json`/`.env`/`logen/` were copied into `Site/` — only the two dirs + index.

Known gap: `Site/index.js` and 6 backend files import `./logen/site.js` / `./logen/selftest.js`,
which do not exist under `Site/` yet. Frontend has **zero** logen references.

---

## 2. The two Site↔Engine protocol generations

The engine is a **standalone process**; the Site never imports engine source.
Two HTTP contract generations exist in linga history.

### Gen 1 — FSM two-phase handshake (linga `dev`, also in `architecture`)

Files: engine side `Bridge/api-server.js`, `Bridge/flags.js`; site side
`backend/gateway/generator/engine.js` (`createEngineBridge`) + `engineLink.js`,
`backend/gateway/api/engineCollect.js`.

Direction (the **engine initiates** the pull):

1. Site `POST {ENGINE_ENDPOINT}/fsm` (engine port 9000) with header
   `x-api-key: <caller key>` and **metadata only** (`fileName, userId, sessionId,
   fileUrl, formId, submitId, source, status`, optional `textSha256/textBytes`).
   No text in this call.
2. Engine gates the call fail-closed: key (`API_KEY/ENGINE_KEY/FSM_KEY`, 32 hex) +
   socket IP allowlist (`ENGINE_ALLOWED_IPS`, else loopback + `DEV_BYPASS_IP`) +
   origin allowlist when Origin/Referer present. No key configured = refuse all.
   `GET /health` is the only open route.
3. Engine stores the record in a pre-receive cache (cap 500, TTL 10 min) and then
   calls **back** to the Site's collect URL (`fileUrl`, default sketch path
   `/api/engine/collect`, praser endpoint `PRASER_ENDPOINT` default `:5055`),
   presenting the same metadata. Site cross-checks the binding and recomputes the
   engine's jobId formula (`${sessionId}-${userId}_${suffix}_${ts.toString(36)}`);
   mismatch → 403 + socket destroyed ("burn"); not-ready → 404 (engine retries
   every 500 ms, 120 s timeout).
4. Engine runs the pipeline on the returned text; Site polls
   `GET /result/:hash` (keyed) for `{ done, engineHash, syllableCount, error? }`.
5. `POST /process` (keyed) accepts an engine-local `srcPath` only — body-text
   pushes were removed.

Two static sketch keys live in `Bridge/flags.js` (caller answer key vs engine
collect key). Env vocab: `ENGINE_ENDPOINT/FSM_ENDPOINT`, `FSM_KEY/ENGINE_KEY`,
`ENGINE_KEY_ANSWER/FSM_ENGINE_KEY`, `SITE_PUBLIC_URL`, `ENGINE_RESULT_ENDPOINT`,
`ENGINE_COLLECT_PATH`, `PRASER_ENDPOINT`, `ENGINE_ALLOWED_IPS/ORIGINS`.

### Gen 2 — queue contract (linga `site`, the version now in `Site/`)

Files: `Site/Backend/gateway/generator/engine.js` (`engineConfig`,
`createEngineDispatcher`), `api/hidden.js` (`createHiddenProcessor`),
`api/engineCollect.js` (`createEngineQueueRouter`, mounted at
`/api/internal/engine/queue`), `queue/processingQueue.js`,
`queue/analysisFinalize.js`, `queue/managerHandoff.js`.

Direction (still engine-initiated, but the Site queue is the authority):

1. **Dispatch (Site → Engine, fire-and-forget accept).** When an analysis job
   reaches the hidden processor, the queue mints a time-boxed `jobToken`
   (`mintAnalysisToken`, TTL `ENGINE_JOB_TIMEOUT_MS` default 120 s) and the
   dispatcher `POST`s JSON to `ENGINE_JOB_URL` with header
   `x-api-key: SITE_TO_ENGINE_KEY` (regex `^[0-9a-f]{32}$`). Body fields:
   `jobToken, formId, submitId, userId, sessionId, filename, extension,
   method, task, job`. Accept timeout 3 s (`ENGINE_ACCEPT_TIMEOUT_MS`).
   Non-2xx / unreachable → `queue.abortAnalysis` (engineRound `skipped`).
   With no `ENGINE_JOB_URL` the dispatcher is dormant and analysis closes on the
   Site artifact (`engineRound: 'unwired'`).
2. **Pull source (Engine → Site).** `POST /api/internal/engine/queue` with
   `x-api-key: ENGINE_TO_SITE_KEY` (timing-safe compare) + the 7 metadata fields
   (16 kb JSON). `queue.beginAnalysis(meta)` validates state
   (`ENGINE_ACCEPTED`, once-only `engineServed`), flips to `ANALYSING`
   (engineRound `running`), and streams the raw source as `text/plain` with
   `X-Job-Token/X-Form-Id/X-Submit-Id/X-User-Id/X-Session-Id/X-Filename/
   X-Requested-Extension/X-Content-Bytes/X-Content-SHA256` headers.
   Limits 64 MB source, 60 s transfer.
3. **Push result (Engine → Site).** `POST .../result` as a raw body
   (64 MB cap) with the same `X-*` metadata headers plus `x-mime-type`,
   `x-bytes`, `x-sha256`. Site verifies: state (`ANALYSING` + served),
   extension rules (`acceptsAnalysisResultExtension`: txt/docx/pdf; staged docx
   may come back txt and the Site renders final docx/pdf itself), filename
   safety regex, MIME map (`RESULT_MIME`), byte count, and SHA-256.
   `finalizeAnalysisArtifact` stores it, `queue.completeAnalysis` → `FINISHED`.
   Errors → `queue.failAnalysis` → `FAILED`; expired tokens → 410; bad state → 409.

Queue state machine (`QUEUE_STATES`):
`RECEIVED → SITE_PROCESSING → SOURCE_READY → ENGINE_ACCEPTED → ANALYSING →
FINISHED` with `FAILED` / `EXPIRED`. `FINISHED` is reached twice in a full
circle; `taskComplete` additionally requires `engineRound ∈ {done, skipped,
unwired}` and a `finalPath`. Frontend renders these same labels.

Env vocab (Gen 2): `ENGINE_JOB_URL`, `SITE_TO_ENGINE_KEY`, `ENGINE_TO_SITE_KEY`,
`ENGINE_ACCEPT_TIMEOUT_MS`, `ENGINE_JOB_TIMEOUT_MS`, `PARSER_RUNTIME_DIR`,
`DB_FILE`, `FRONTEND_DIR`, `LOG_CHECKS`, plus the Site's own
`COOKIE_SECRET/SESSION_SECRET` (≥32 chars, must differ).

The Gen 1 engine `Bridge/api-server.js` speaks **/fsm**, not the Gen 2
`ENGINE_JOB_URL` queue contract — when the Engine_host is wired to `Site/`,
its API surface (or a Bridge interjection adapter) must implement Gen 2.

---

## 3. The standalone Engine, from the inside (dev/architecture sketch)

`Engine_host/Bind/` currently holds six files blob-identical to both
linga `dev` and `architecture` `Bridge/`: `api-server.js, flags.js, bridge.js,
Ginit.js, path.js, logen.js`. The engine stays importable without express;
`api-server.js` is only an express wrapper.

Pipeline entry (dev `init/cli.js`, `init/initS.js` — not yet copied to lingux):

- no side effects on import; lazy init; `.env` anchored to module path, not cwd
- `configure({ srcPath, writeSyllable, segmentedMode, debugMode })` then
  `grammarPipeline({ srcPath, hash })`
- pipeline stages: `readAndPrepare` (generators/input) → `runSegmentor`
  (MonoSyllabism/main/phoneme/lexer) → `runBuild/runBuildPos` (graph/build) →
  `bridge()` / `bridgeSyllable()` (Bind/bridge.js): `runTagger`
  (phoneme/phonology) → `runRuleEngine` (Bind/Ginit.js, pass-through kernel) →
  stream writers (utilities/disk, formatter, SfomatterForP)
- outputs named `segmented_{hash}_*`; `invokeWithHash` /
  `invokeSyllableWithHash(hash)` read them back; `hashKind()` validates ids
- **contract: the API returns positions, not segmented text** — the caller
  writes segmentation into its own original string
- Bind/logen.js is the single-file engine logger (report-first, FILE_MAP
  per-module logs); distinct lineage from the Site's four-file `logen/`
  (core/site/engine/selftest, event-bus + chain-checks). Do not merge blindly.

MonoSyllabism itself is not yet in `Engine_host/`. Candidate sources already in
this repo: `Scraper/Engine/MonoSyllabism`, `Proofreading/Engine/MonoSyllabism`,
and linga `dev`/`architecture` `MonoSyllabism/` (the fullest tree, with
generators/graph/main/map/mapbuilder/utilities). The scraper's `wasm/box`
(box.wasm = QuickJS engine + obfuscated loader + AES payload) is the newer
sealed packaging that replaces `map/master.json.enc` + `map/payload.jsc`.

---

## 4. The parser embedded in the Site backend — disassembly map

The Site backend does **not** contain parser source; it reaches the standalone
parser package through exactly two coupling styles, both currently rooted at a
`sitedir/Parsed/` tree that was **not** copied into lingux. Target home:
`Parser_host/` (empty). On linga `site` the package entry files are
`Parsed/parser/manager.mjs` and `Parsed/parser/index.mjs`.

Coupling point A — path constants, `Site/Backend/file/paths.js`
(`PROJECT_ROOT` = `Site/`, everything relative to it):

- `PARSED_ROOT="Parsed"`, `PARSER_DIR="Parsed/parser"`, map/model/font dirs
- `PRASER_MANAGER = "Parsed/parser/manager.mjs"` — dynamically imported by
  `Site/Backend/file/praser.js` (`loadManager()` → `new Manager({ outputDir })`,
  singleton; `closePraserManager()` on shutdown)
- runtime dirs overridable via `PARSER_RUNTIME_DIR` (default `Parsed`):
  `upload/input/{txt,pdf,docx}`, `upload/quarantine`, `.output/{txt,original,docx,.tree}`
- `validatePraserAssets()` hard-fails boot unless these exist: manager.mjs,
  model `zawgyiUnicodeModel.dat` + `mya.traineddata`, maps
  (`cipher-map, mm-score, cleanup, scan, normalize-map, zg2uni-rules .json`),
  fonts (`Parsed/fonts/Unicode/PYIDAUNGSU-2.5.2_REGULAR.TTF`,
  `used/AnonymousPro-Regular.ttf`, `used/MyanmarSagar.ttf`)
- `Site/index.js` calls `validatePraserAssets()` + `ensurePraserDirs()` before
  accepting traffic

Coupling point B — hard relative import outside Backend:

- `Site/Backend/gateway/queue/analysisFinalize.js` line 4:
  `import { writeDocxPlain, writePdf } from '../../../Parsed/parser/index.mjs';`
  (used to synthesize final DOCX/PDF when the engine returns txt against a
  staged docx). This is the only deep `../` escape; repoint when Parser_host lands.

Call shape across the boundary (`praser.js` + `queue/managerHandoff.js`):

- `createPdfParser()` / `createDocxParser()` → `manager.dispatch({...routing,
  inPath, filename, inputKind, outPath})` where `managerPayload(intent)` maps
  frontend intents to `{ job: extracting|ocr|null|false, method: default|manual,
  output: txt|docx|pdf }` (analysis always stages `docx` for the engine round)
- reply `{ file, text?, ... }`; `praser.js` strips CLI artifacts
  (`#` lines, `--- Page N ---`, collapsed blank lines) and throws on empty text
- `bindIdentity()` returns null here (the FSM-era binding concept lives on in
  the Gen 2 queue token instead)

Repoint strategy hints already present: `PARSER_RUNTIME_DIR` env override and
the single `PRASER_MANAGER` constant mean most of the move is one constants
edit plus fixing the one hard import in `analysisFinalize.js`. Verify every
`validatePraserAssets` entry exists under the new home or boot fails closed.

---

## 5. Shared parser-routine group (`Bridge/parser-routine/`)

Scaffolded 2026-10-24. Two **consumer** routines sharing one decision
contract (scanned→OCR / old→preserve / convertable→convert; DOCX input to be
added on the scraper side), not two language ports of one module. The split
is consumer, not language — the only hard rule is browser = JS:

- `Bridge/parser-routine/site/` — Site frontend probe is JS (browser cannot
  run Python); Site backend may be node OR Python. Sources today: frontend
  `detect.js`/`detect.ts` (isomorphic, candidate canonical core) +
  `upload.js` verdict mapping, backend `managerHandoff.js`/`praser.js`
- `Bridge/parser-routine/scraper/` — Python-first crawler saving logic, but
  allowed to run the frontend JS via Node subprocess — pattern already in
  production: `text_collect.py` `_find_node22()` → `node segment_bridge.mjs`,
  OCR service spawns `worker.mjs`. Sources today:
  `Scraper/crawler/bin/pdf_classify.py` + `Scraper/praser/` package,
  consumers `save_local.py` / `text_collect.py`
- Shared JS must stay isomorphic (no node: builtins/process/fs in the probe
  core; thin Node wrappers only). Deps: root `pyproject.toml` / root
  `package.json`, nothing nested in the group.
- Full threshold table, verdict gates, and source map live in
  `Bridge/parser-routine/README.md`. No code moved yet — dirs are landing zones.

## 6. Scraper inline engine/parser removed — Bridge entry drafts (2026-10-24)

Deleted from `Scraper/` (sources remain safe on the scraper repo `main`):

- `Engine/` — inline MonoSyllabism + Bridge shims + `.cache-tree` (777K)
- `ocr_runtime/Praser/` — inline JS parser runtime, 27M
- `praser/` — inline Python parser package (detector, pdf_extract, pdf_fonts,
  scan, rabbit, cleanup, mm_score, paths)
- `map/` + `model/zawgyiUnicodeModel.dat` — parser assets resolved by
  `praser/paths.py` (root-level, served only that package)

Kept by explicit owner decision: `Scraper/wasm/` (the sealed box build does
not exist on the engine branch). Its build inputs
(`Engine/MonoSyllabism/mapbuilder/base`, `Engine/knowledge/...`,
`Engine/Bridge/restore-master.js`) now dangle and must retarget to
`Engine_host` when the wasm build is wired.

Replacement boundary drafts (entry contracts, not implementations):

- `Bridge/Engine/segment-bridge.draft.mjs` — Node22 subprocess, stdin/stdout
  file protocol (`U+001D` docs, argv[2] out file), four engine calls behind
  one boundary: treeFile / normalize(mapperNormalize) / segment(runSegmentor)
  / syllableLine(toSyllableLine)
- `Bridge/Engine/engine-ready.draft.py` — systemd preflight (Node≥22,
  artifacts, tree, empty-input bridge boot, `--fix`), paths retargeted as draft
- `Bridge/Parser/pdf-classify.draft.py` — `ClassifyResult` dataclass verbatim,
  `classify_pdf(bytes)`, `extract_convertable_text(bytes)`, `get_detector()`,
  shared threshold constants; bodies NotImplementedError until Parser_host
- `Bridge/Parser/ocr-worker.draft.mjs` — stdio worker protocol intact
  (`OCR_RESULT` lines, ready banner, `{input,output}`/`{close}` requests),
  all parser modules behind one boundary object

Scraper callers left in place and now dangling (the wiring backlog, do not
silently "fix" without instruction): `crawler/bin/segment_bridge.mjs`,
`crawler/bin/pdf_classify.py` (+ its `save_local`/`text_collect` importers),
`deploy/continuous-ocr/worker.mjs`, `deploy/continuous-ocr/run.py`,
`deploy/continuous-parse/run.py`, `deploy/engine_ready.py`,
`deploy/install_service.py`, `ocr.py`, `parse.py`.

## 7. Site inline parser layer removed — Bridge drafts + routine moved (2026-10-24)

The physical `Parsed/parser` package was never copied into lingux; the inline
parser presence in `Site/Backend` was the adapter layer. Deleted:

- `file/praser.js` — Manager singleton + pdf/docx parser factories
- `file/parser.js` + `file/parser.test.js` — upload router (injected parsers)
- `file/pdfanalysis.js` — analysis-intent wrappers
- `queue/managerHandoff.js` + `queue/managerHandoff.test.js` — moved, not lost
- `queue/analysisFinalize.js` — hard parser-writer import; rules captured in draft

Moved verbatim (pure ESM, zero parser-package imports):
`queue/managerHandoff.js` →
`Bridge/parser-routine/site/manager-handoff.mjs` (`managerPayload`).

Drafts added to the previous dir `Bridge/Parser/`:

- `site-parser-manager.draft.mjs` — Manager dispatch job/reply contract
  (`extracting|ocr|null` × `default|manual|null` × `txt|docx|pdf`), factory
  `{parse, bindIdentity}` shape, analysis wrappers, lifecycle
- `site-parser-writer.draft.mjs` — `writeDocxPlain/writePdf` boundary,
  `RESULT_MIME`, extension rules, `finalizeAnalysisArtifact` contract

Dangling Site callers (wiring backlog): `Site/index.js`,
`gateway/api/incoming.js`, `gateway/api/curl.js`,
`gateway/api/engineCollect.js`, `engineRoundtrip.test.js`. `file/paths.js`
kept (shared) but its Parsed constants/`validatePraserAssets()` dangle; boot
is blocked until Parser_host wiring lands. Full list in
`Bridge/Parser/README.md`.

## 8. Quick file-role index (Site backend)

| File | Role |
|---|---|
| `index.js` (Site root) | express entry; mounts queue router, dispatcher, hidden processor, static frontends |
| `gateway/generator/engine.js` | Gen 2 config + dispatcher (Site→Engine POST) |
| `gateway/api/engineCollect.js` | Gen 2 engine pull/result endpoints, key gate, sha256/size checks |
| `gateway/api/hidden.js` | mints job token, calls dispatcher, aborts on refusal |
| `gateway/queue/processingQueue.js` | state machine, TTL expiry, engineRound, artifact records |
| `gateway/queue/analysisFinalize.js` | result extension/MIME rules, docx/pdf synthesis (**hard Parsed import**) |
| `gateway/queue/managerHandoff.js` | intent → parser manager payload mapping |
| `file/praser.js` | in-process parser Manager singleton (pdf/docx parsers) |
| `file/paths.js` | all path constants + asset validation (**Parsed coupling**) |
| `gateway/proxy/httpLog.js` | logen named imports: palette, moduleBadges, statusColors, stamp, paint |
| `cookie/{cgen,sanitized}.js`, `db/session.js`, `gateway/api/curl.js` | default `logger` import; only `logger.log(...)` truly called (`.info/.warn/.error` are `?.` no-ops) |
