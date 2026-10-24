# Project Structure — linga

Not a system description. Only what an agent would otherwise get wrong here.
`docs/reference` is the companion ledger of *wrong assumptions* — read it before
grepping, and append new rows **there**, not here.

## Read first

- `AGENTS.md` — the rules that actually bite: one task at a time, no test files in the
  repo root, reusable scripts stay in `.bin/`, no hunting for errors inside
  `R_Engine/Linga/*`, plain language (no jargon) in architecture answers, executable
  sources beat prose.
- `docs/reference` — the "these filenames lie to you" list + the four API surfaces.
- `CHANGELOG.md` — must be updated **before a PR**. Newest entry goes directly under the
  note at the top (file is reverse-chronological). Sections are `### Added/Changed/Fixed`
  under `## [x.y.z] - YYYY-MM-DD` (AGENTS.md's sample shows `## Added`; the file uses `###`).
  CHANGELOG's version numbers do **not** track `package.json` — take the next number from
  the CHANGELOG's own top, not from `package.json`.

## Three webs — and a fourth service nobody boots

| web | entry | port | watched by |
| --- | --- | --- | --- |
| site | `R_Site/index.js` | 3000 | `nodemon.json` (root) |
| engine | `R_Engine/init/api-server.js` | 9000 | `R_Engine/nodemon.json` |
| build | `R_Site/Build/spa` via vite | no port | `vite build --watch` → `R_Site/Build/spa/frontend/` (gitignored) |
| **praser** | `R_Site/Praser/Python/module/api.py` | 5055 | **not started by any script** |

- Every web **must** run with the repo root as cwd: both path maps
  (`R_Site/_file/paths.js`, `R_Engine/Bridge/path.js`) hold *relative* constants
  resolved against `process.cwd()`. Starting a web from its own folder silently
  doubles the paths. Same rule for `check-imports` and the test runner.
- PDF/DOCX uploads need the praser, and no `npm run` script or `.bin` script starts it.
  Run it by hand: `cd R_Site/Praser/Python && python3 module/prase.py --serve --host 127.0.0.1 --port 5055`.
  The CLI defaults are `--host 0.0.0.0 --port 5000` — wrong for this repo on both counts.
- `R_Site/Praser/js/` is the same praser core ported to ESM (no npm dependencies):
  `js/module/prase.mjs` + `pipeline/render/pdf_extract/docx_extract/detector/rabbit/normalize`
  + `js/module/model/` + `js/fonts/`. Core parser only — no Flask, no argparse, no job store —
  and it reads nothing from `Python/`. Check: `cd R_Site/Praser/Python && node ../../../.bin/praser-parity.mjs <ref-dir>`.
- The build web is a watcher, not a server: there is no dev proxy for `/api`, so the
  **built** `frontend/` (served by the site) is the only working UI. `--spa-dev` gives HMR
  without `/api`.
- Do not hand-start `node R_Site/index.js`: it shells out to a full `vite build` at boot
  and exits the process if that build fails. `SKIP_BUILD=true` (already set in
  `nodemon.json`) is what suppresses it.

## Commands

```bash
npm run setup          # stage 1: npm trees + pip (flask,fpdf2 only) + cloudflared
bash ./.bin/bootstrap.sh boot --detach      # stage 2: the three webs
bash ./.bin/bootstrap.sh status             # what is listening (reads the real ports)
bash ./.bin/kill.sh                          # stage 3 then 2; `kill.sh full` also sweeps ports
npm test               # import-graph guard + .bin/node/*.test.mjs
npm run lint           # eslint .   (needs the root install — see below)
npm run check:imports  # the guard on its own, ~1s
```

- `npm run dev`, `npm run boot`, `bootstrap.sh test|dev|setup` are **not** thin wrappers:
  each runs `do_setup` first — npm installs (unless `--skip-install`) **and rewrites
  `.env`**. `npm test` alone does not. To restart one web without any of that, use
  `npm run dev:site` / `dev:engine`.
- `npm run boot` = `boot --detach full`, and `full` chains stage 3 (the tunnel).
  For webs only, use `bash ./.bin/bootstrap.sh boot --detach`.
- The shell surface is the **repo-root `.bashrc`**: one plain `alias name='cd ~/linga/<dir> &&
  ./script.sh args'` per command, paths written out, nothing computed, no installer to source.
  Keep that shape when adding one — the first four lines are the reference, and `#!modify all the
  line in below` marks where the generated block starts. Aliases expand only in an interactive
  shell, so from a script, CI or `bash -c` call the named script yourself (that is why every
  alias has an `npm run` twin in `package.json`).
- `~/linga` is hardcoded in every alias body: work the repo at `$HOME/linga` or the shortcuts
  point at a directory that isn't there. `npm run shell:install` (and `setup.sh` stage 1) only
  adds one sourcing line to `~/.bashrc`, inside markers, idempotently.
- Focused verification (single check, in dependency order, no install side effects):
  `bash ./.bin/test.sh [imports|local|frontend|api|tunnel|cloudflareEdge|worker|guard|logs]`
  — run it *after* booting; it only curls.
- Single test: `node .bin/node/run-tests.mjs --only <name-fragment>`.
  Flags: `--live` (probe the three running webs), `--no-live`, `--strict` (fail on orphan
  imports too). Order is fixed: imports guard → test files → live probe.
- Worker deploy is a separate flow, not a stage: `npm run worker:flow` (install → login →
  `secret put EDGE_SECRET --env production` → deploy → check). The `--env production` part
  is load-bearing; a secret put without it lands on a Worker the domain does not point at.

## `.env` — three traps

1. `.env` lives at the **repo root** and is **regenerated on every `setup`/`boot`**:
   secrets are re-minted and only `DB_*` plus the edge block (`TUNNEL_TOKEN`,
   `EDGE_SECRET`, `TUNNEL_PROTOCOL`, `TRUST_PROXY`) are carried over. Anything else you
   hand-add (`PORT`, `PRASER_ENDPOINT`, `SKIP_BUILD`, …) is wiped. Put durable config in
   the environment or in the shell command instead.
2. Precedence is *environment wins over file*, in one place: `env_first` in `.bin/lib.sh`.
   Reading `.env` alone reports "not set" for a Codespace repo-secret — worse than not
   checking. Never `source .env`: it contains a `//`-style comment the shell tries to run.
3. The generated file writes `NODE_ENV=production` **together with** the four
   `DEV_BYPASS_*=true` flags — and every bypass hard-returns false in production. So on a
   fresh boot the flags are inert: you get the DB-backed, session-gated site, and
   `curl` 403s. To get the dev posture (memory session, DB-free request layer) flip
   `NODE_ENV=development` yourself. `.gitignore`'s `*env*` also means no `.env.example`.

## Tests

- `npm test` is **not** evidence of health. The runner's only test file
  (`.bin/node/silent-original.test.mjs`) asserts a **retired** contract and is listed in
  the `ADVISORY` ledger inside `run-tests.mjs`: it still runs and prints `FAIL`, but it
  never turns the run red — output ends in `ALL PASS`, exit 0. Only the import-graph
  guard is a real signal in this checkout.
- Tests live in `.bin/node/` (the runner scans only that dir). A `*.test.mjs` elsewhere —
  e.g. `R_Site/Backend/db/db_test.js` — is not run by anything.
- The suite imports the site web's modules but `.bin/node/` has no `package.json`:
  it needs `.bin/node/node_modules → ../../R_Site/node_modules` (only `bootstrap.sh setup`
  creates it). Without it every test dies on `ERR_MODULE_NOT_FOUND`, which the ADVISORY
  ledger then hides.
- Run everything from the repo root, including a single test file.
- `npm run lint` fails outright in a fresh clone: `eslint.config.js` imports `@eslint/js`
  and there are **no** `node_modules` in this checkout (root, `R_Site`, `R_Engine`,
  `R_Site/Build`) until you install. There is no typecheck step. `npm run format` names
  `prettier`, which is not a dependency of any package.json (only `eslint-config-prettier`)
  — it is not wired.

## Conventions that differ from defaults

- `git.sh` (repo root and `.bin/` hold byte-identical copies — edit **both**, or neither)
  stages everything, bumps `package.json`'s version itself (patch, each digit rolls over at
  **9**, so `3.4.9 → 3.5.0`), and appends a tab-separated row to `.commit`. Lockfiles are not
  tracked (`.gitignore`), so installs use `--no-package-lock`; `package-lock.json` appearing
  in `git status` is noise to delete, not a change to commit.
- All shell scripts source `.bin/lib.sh` and use `$REPO_ROOT`; it *finds* the root by walking
  up to a `package.json`. Never re-introduce `../`-counting (`$SCRIPT_DIR/..`) — that is the
  bug this file exists to kill. Scripts must stay POSIX-sh clean (busybox ash on Alpine): no
  `BASH_SOURCE`, no arrays, no `[[ ]]`. Port checks read `/proc/net/tcp` because `ss`/`lsof`
  may be absent.
- Actual directory names contain deliberate misspellings — do not "fix" them:
  `R_Site/Praser` (not Parser), `lincense`, `R_Site/_file`, `R_Engine/Linga`,
  `R_Site/Build/mapbuilder/mymap`. All four inner `package.json` files are named `FSMGR`
  (only the root is `MyGmr`), so a name search finds nothing useful — search by path.
- `.jsc` / `.enc` are build outputs that are **tracked**:
  `R_Engine/MonoSyllabism/map/map-runtime.jsc` (V8 bytecode, tied to the Node version that
  compiled it) and `R_Engine/Linga/_knowledge/json/master.json.enc` (AES-GCM, read via the
  obfuscated `R_Engine/Bridge/secure.js`). Editing `secure.js` by hand edits generated
  output; `.enc` plaintext must never be committed. Regenerate with
  `R_Site/Build/mapbuilder/{obfuscator,secure-json}.js` — note the `.secrets/` key sidecars
  they write are **not** covered by `.gitignore`.
- Never watch or `git add -A` blindly through the dirs the servers write into
  (`R_Site/Praser/Python/{logs,upload}`, `R_Engine/{.output,.tree,input}`,
  `R_Site/Build/spa/frontend`) — nodemon restart loops and giant diffs both come from there;
  `.bin/bootstrap.sh clean` drops them. The ignore rules only cover half of it: `logs/`,
  `*.output/` and `*frontend/` are ignored, but **`upload/` and `R_Engine/.tree/` are not**,
  and `upload/input/{pdf,docx,txt}` hold tracked fixtures — so since `git.sh` stages `-A`,
  one test upload commits a user's document into the repo.

## Warn — drift in this checkout (verified 2026-09-16)

- The root `test.sh` symlink that `pull.sh` chmods does not exist — `.bin/test.sh` is the
  real path, and it is a script, not an alias: run `bash ./.bin/test.sh <word>`.
- Several path constants and comments point at pre-rename locations that no longer exist.
  They are unused declarations, so `check-imports` passes and nothing breaks — but do not
  assume a filename you read in a comment or doc is real. Missing-but-named:
  `R_Site/Build/mapbuilder/{map.build,build-bytecode,build-secure,encrypt-data,decrypt-data}.js`,
  `utility-tools/bundler.js`, `R_Engine/Linga/main/modules/`. Renamed and only half-updated:
  `utility-tools/test/…` → `.bin/node/…` (header comments in `.bin/node/*.mjs` still say the
  old path), `Entry/` → `init/`, `Operation/` → `lib/entry/`, `Server/` → `Backend/`.
  `R_Site/.env` does not exist either — the site tries it first and falls back to the
  repo-root `.env` (`EnvCandidates()`).
- `docs/reference` and `.bin/devbypass-roundtrip.sh` still name `Site/Public/PRASER/...` and
  `PRASER/Python/...` without the `R_Site/` prefix; the round-trip script's fixture paths are
  broken in this layout, so it is a reference for the request sequence, not a runnable check.
- `.bin/gitinit.sh` hardcodes the owner's remote, GitHub user, noreply email, a branch name
  and a private SSH key filename. It is not a generic template — do not run it to "init" anything.
- `.bin/node/scripts.db` (2.5 MB, tracked) belongs to `scrmgr.js`, a standalone tool. Nothing
  in the boot path or the tests reads it, and `better-sqlite3`'s native build is intentionally
  skipped by `--ignore-scripts`, so `scrmgr.js` is expected to be unusable in a sandbox.
- Not yet verified here: the praser handshake end-to-end, the tunnel/worker stages (no
  `cloudflared`, no `TUNNEL_TOKEN` in this sandbox), and anything that needs MySQL.
