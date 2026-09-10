# Project Structure — Lingux



This file is NOT a system description. It lists what agents assume WRONGLY
from typical filenames and workflows. Read before grepping. Delete a row when
its mismatch no longer exists. Append new rows BELOW THE LINE. One fact per row. Scroll to the button before u continue the next session 

## Corrections — wrong assumptions agents make

<!-- append below this line only -->

- The API contract is request/response. Ids travel in the payload. No queues, no websockets — do not invent one.
- `Site/Server/gateway/proxy/` is the JS proxy pattern (intercept + delegate), not an HTTP proxy.
- Site and Engine deploy separately. Directory constants differ on purpose (Site writes `.output/` with the dot because the Engine reads it). Bridge, do not repoint.
- Engine outputs are `segmented_{hash}_*.txt`; the hash is the join key. The engine hash (`YYYYMMDD_HHMMSS_mmm`) is not a server id — the server holds `userId`/`visitorHash` (sha256-32), `formId`, `submitId` (uuid). `hashKind()` refuses unknown shapes.
- The Engine public API returns POSITIONS, never segmented text — the caller segments its own string. Do not "fix" this.
- `curl` getting 403 is by design — it never visited the SPA, so it has no cookie row. Do not build threat models around curl.
- Daily quota is anti-spam for anonymous visitors, not billing.
- Every FILE is parsed server-side (.pdf/.docx via the PRASER service, .doc via antiword, .txt from disk). Request `text` is for plain-text submissions only.
- က္က → ဣ in syllable output is correct (Pali; က္က does not stack).
- The Engine does no regex linguistics — table lookups + tree descent. Regex only in the tagger (Private/monoSyllabism/main/phoneme/phonology.js — dates/phones/IDs).
- Knowledge data is read encrypted (`master.json.enc` via secure.js). Never copy or commit plaintext master.json.
- `.env` is a placeholder — no security essays.
- Some seams are unwired on purpose. Ask before completing one.
- PRASER output shape: `preview` carries `content` (one plain text, no banner/markers/HTML) + plain `changes` pairs; docx jobs finalize txt-only.
- `DEV_BYPASS_*` flags exist for agents that cannot use the interactive UI (curl-style testing). The SESSION name misleads: every gate here is a COOKIE check — express-session itself is never bypassed (it stays mounted; dev only swaps its store to MemoryStore). Only `DEV_BYPASS_SESSION` is fenced to dev — it fail-closes under `NODE_ENV=production` (boot banner: IGNORED) and in dev it alone opens headerCheck (bot UAs included) + cookieGenerator + cookieDBCheck together. `DEV_BYPASS_QUOTA` / `DEV_BYPASS_IP` / `DEV_BYPASS_HEADER` carry no env guard: QUOTA makes the request/quota layer DB-free, IP/HEADER skip the MM-country check (IP also satisfies cookieDBCheck). Bot-403 runs before IP/HEADER, so curl is still rejected in prod with every flag on; all flags off behaves identically in both envs. `ALLOW_AGENT_UPLOAD=true` is the master: every gate open at once (today's all-flags-on in one flag), dev-fenced like SESSION. Specific flags stay independent per-layer switches — quota can run free while cookie/IP gates still reject. Flags on ≠ production posture.
- Filename creation lives in the FRONTEND (`responses.js` → `{submitId}{ext}`); userId + session identity are validators, not optional metadata.
- Site → Engine delivery is a metadata BODY (`{submitId, validators, sha/bytes}` → keyed POST /fsm); the TEXT arrives via the engine-initiated praser collect. `readFileContent`/`invokeWithHash` are engine-internal (engine cwd); `srcPath` is same-machine-only.
- The engine api-server must run with the repo root as cwd; the Site reads results back via the same-repo `invokeWithHash` import. Cross-deployment HTTP pull is NOT wired — do not assume it.
- `runMain()` resets the engine workspace every call — only the newest result exists.
- Two webs, the ENGINE initiates: keyed `POST /fsm` (hidden.js delivery) triggers an outbound collect from the praser — `/api/engine/bind` (uploader declares the minted identity, once) then `/api/engine/collect` (engine presents; praser cross-checks and responds WITH the text). Misaligned → 403 + burned. One bind = one collect.
- The KEY guards hidden → engine only (`/fsm`, `/result/:hash`, `/process`, srcPath). The praser hop is unkeyed BY DESIGN — the delivered metadata is the credential. `/health` is the engine's only open route.
- Binaries are opened ONLY by the praser service — the Site forwards uploads unopened, the engine never touches them. All bomb caps live there (stream/member size+ratio, door caps). A cap hit refuses the document (400) — never a silent empty text.
- The praser binds `127.0.0.1:5055` by default (5005 retired); non-loopback callers need `X-Praser-Key` (`PRASER_KEY`) — fail closed when unset.
- `createFsmReadStream` (Bridge/streamline.js) yields at `\n` boundaries (bytes/20 chunks, 64-512KB for the 10MB frontend cap) — never splits Burmese mid-line. Do not "fix" the stream. HTTP JSON bodies are buffer-concatenated and decoded ONCE (per-chunk decode corrupts multi-byte chars).
- Map dir source for bundler may exist outside the repo (e.g. Tools/build relative ../../mymap/); bundler and bytecode scripts resolve it if passed or found.
- Project bootstrapping pipeline entry is `bootstrap.js` (`npm run bootstrap` / `Tools/build/initiate.js`); builds map bytecode, verifies encrypted JSON, builds engine trees, boots praser on :5055, builds SPA, and launches Express.
- Cookie-skipping alone (`DEV_BYPASS_SESSION`, fenced master) never skips quota — `checkQuota` (hardcoded 3) still runs real: dev funnels every visitor onto users row id=1, the prod fence mints fresh real rows instead.
- Quota allow/429 verdicts exist only with a DB. A sandbox `tried DB` throw is an unknown verdict, not enforcement — do not read DB-path sandbox failures as closed gates.

## The four API surfaces

| Surface | Contract |
| --- | --- |
| Site (`gateway/api/`) | `POST /api/submit` → `{formId, submitId, text, status}` (session-gated) · `/api/result` by formId+userId · `GET /api/hidden/raw/:submitId` (keyed txt stream, no-store) |
| Engine (`Private/monoSyllabism/api-server.js`) | `POST /fsm` (keyed, hidden's payload; TRIGGERS the collect) · `GET /result/:hash` (keyed) · `POST /process` (keyed, srcPath only) · `GET /health` (open) → `{hash, syllable positions}` |
| Engine read (`Ginit.js` + `Bridge/streamline.js`) | hash → filename → streamed file → text |
| PRASER (`PRASER/Python/module/api.py`) | Flask on 127.0.0.1:5055: `/health` · `/api/preview` (job_id + content) · `/api/content` · `/api/finalize` · `/api/engine/bind` + `/api/engine/collect` (handshake) |

## Request path (Site)

```
POST /api/submit → quota → createUploadSession (formId)
  file? → PRASER service (unopened forward) → text  |  no file → req.body.text (validated)
  mint {submitId, filename} → rawSaver (.output/txt) → finalizeUpload
  bind identity to praser job → keyed /fsm delivery → poll /result → invokeWithHash
  docx uploads: engine result re-wrapped to .docx by the PRASER CLI
```

## Unwired seams — ask first

- Cross-deployment result pull over HTTP (same-repo `invokeWithHash` only, today).
- `openFsmConnection()` in `generator/string.js` is a legacy stub; the real bridge is `generator/engine.js`.
- `STATIC/Build/index.html` is the SPA; `page.html` is not wired.

## Watch out

Two path modules (`Site/Public/_file/paths.js` vs Engine `Bridge/path.js`) · two HTML pages · two deployments · engine cwd = repo root.

## Env flags (what the code reads)

`SKIP_BUILD` · `PORT`/`API_PORT` · `SESSION_SECRET`/`COOKIE_SECRET` · `DB_*` ·
`DEV_BYPASS_SESSION` (dev only, hard-off in production) · `DEV_BYPASS_QUOTA` /
`DEV_BYPASS_IP` / `DEV_BYPASS_HEADER` (no env guard — live wherever set) ·
`ALLOW_AGENT_UPLOAD` (master: every gate at once, dev-fenced) · `UPLOAD_MAX_MB` ·
`FSM_ENDPOINT`/`FSM_KEY` · `ENGINE_ENDPOINT`/`ENGINE_KEY`/`ENGINE_TIMEOUT_MS` ·
`PRASER_ENDPOINT` (default :5055) · `PRASER_KEY` (machine-boundary) ·
`PRASER_MAX_UPLOAD_MB`/`PRASER_MAX_STREAM_MB`/`PRASER_MAX_MEMBER_MB`

---

Note: when asked to open a PR, write down the wrong assumptions YOU had that
needed correcting. Keep it minimal — leave later agents room to be wrong too.

😉 KaungMyatThu