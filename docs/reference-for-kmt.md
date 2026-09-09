**! Do Not append any other content  in here unless explicitly ask**


# Map Binary Build — What Replaced What, and How to Rebuild It

Plain-language guide. No deep theory — just which file replaced which, where each
one lives, the build steps, and what the encrypted JSON needs to work.

---

## TL;DR — the replacements and their exact locations

| You used to have | Replaced by | Exact location |
|---|---|---|
| Readable map dir inside `mapper/` (5 JS files) | **`map-runtime.jsc`** — one locked binary file | `Private/Syllable/mapper/map/map-runtime.jsc` |
| — | Loader that reads the `.jsc` | `Private/Syllable/mapper/map/map-loader.js` |
| Plain `master.json` | **`master.json.enc`** — locked JSON | `Private/Engine/_knowledge/json/master.json.enc` |
| — | Key holder that opens the `.enc` | `Private/Bridge/secure.js` |

Everything map-related now lives in **one self-contained dir**:
`Private/Syllable/mapper/map/` — sources, loader, and every build output.

```
Private/Syllable/mapper/map/
├── sourceMap.js  _function.js  sourceMapper.js  _encode.js  _decode.js   ← readable sources (placeholder mirror)
├── idmapper.js  master.json                                                    ← reference copies (not used by the build)
├── map-loader.js               ← the loader the engine imports
└── bundle.js  actual.mjs  map-runtime.cjs  map-runtime.jsc                    ← build outputs (appear here on every rebuild)
```

> The source files in the map dir are the **placeholder mirror** of your real
> map dir — kept so the build can be tested in this repo without exposing the
> real logic. The `.jsc` built from them works, but with simplified logic.

---

## Part 1 — The map dir → `map-runtime.jsc`

### The 5 files that go in

| # | File | What it holds |
|---|---|---|
| 1 | `sourceMap.js` | the character tables (MMap, NewMap, Priority, Glue, IMPOSTER…) |
| 2 | `_function.js` | helpers (compose, decompose, A–Z checks…) |
| 3 | `sourceMapper.js` | Myanmar ↔ ASCII switching (mapperStr, toBurmeseStr, isTail…) |
| 4 | `_encode.js` | normalize / MyNormalize |
| 5 | `_decode.js` | output formatting (formatResolvedLine, makeReadable, getBatchSize) |

`idmapper.js` and `master.json` also sit in the map dir, but the JSC build does
**not** use them: `idmapper.js` already has its real home at
`Private/Syllable/mapper/idmapper.js`, and `master.json` belongs to the
knowledge JSON folder (see Part 2).

### How it is built — 3 steps, 1 command, outputs land in the map dir

```bash
node Tools/build/build-bytecode.js
```

No arguments needed. It reads the sources from the map dir and writes every
output back into the same dir — nothing appears at the repo root, so there is
nothing to move around after a rebuild. (`--src <dir>` still works if you ever
want to build from a different source dir.)

What happens, in order:

1. **Flatten** — `Tools/build/bundler.js` joins the 5 files into one
   `map/map-dir/bundle.js`. It removes all `import`/`export` lines and switches
   the debug hooks off.
2. **Scramble + lock** — `Tools/build/build.js` scrambles that code
   (javascript-obfuscator), then locks it with AES-256-GCM. It writes
   `actual.mjs` (importable version) and `map-runtime.cjs` (CommonJS version)
   into the map dir. The key and the locked code are embedded inside those files.
3. **Compile** — `bytenode` turns `map-runtime.cjs` into `map-runtime.jsc`
   (V8 bytecode — a compiled file with no readable code left), then the script
   self-tests it.

### Files in the map dir after a build

| File | Keep or delete? |
|---|---|
| `bundle.js` | temp — gitignored (contains readable source) |
| `actual.mjs` | temp — gitignored (optional importable runtime) |
| `map-runtime.cjs` | temp — gitignored (only needed to re-compile the `.jsc`) |
| **`map-runtime.jsc`** | **KEEP — this is the replacement for the map dir** (tracked in git) |

### How the engine uses it

Nothing imports the map source files anymore. Engine files import the loader:

```js
import { normalize, mapperStr } from '../map/map-loader.js';   // from mapper/object/
import { MyNormalize } from '../mapper/map/map-loader.js';     // from builder/
```

`map-loader.js` finds `map-runtime.jsc` **next to itself** and re-exports all
31 functions under the same names, so every importer keeps working without ever
seeing the map source. The loader resolves everything relative to its own
location — it works no matter which directory you run Node from.

### Test run — done today from the placeholder map dir

- Build: `node Tools/build/build-bytecode.js` → OK, all 4 outputs written into
  `Private/Syllable/mapper/map/` (built on Node v22.22.3, `.jsc` = 54.39 KB)
- Loader from repo root: OK, 31 exports, `ကတ်` → `Am` → `ကတ်` round trip
- Loader from a **different working directory** (`/tmp`): OK — loader is
  location-independent
- Real engine importers (`builders.js`, `object/BurmeseToAscii.js`,
  `object/AsciiToBurmese.js`, `Bridge/readable.js`, `breaker/tagger.js`,
  `breaker/segmentor.js`): all load OK through the new loader

### Rules to remember

- A `.jsc` only runs on the **same Node version** that built it. Rebuild it on
  the machine you deploy on.
- For production, put the **real** map sources into the map dir and re-run the
  same command — the placeholder files give working but simplified logic.
- `map-runtime.jsc` is tracked in git. If you rebuild it with real (sensitive)
  sources, git will show it as modified — commit that intentionally, or
  untrack it first.
- `map-runtime.cjs` (encrypted JS) is the portable fallback if you ever can't
  match Node versions.

---

## Part 2 — Plain `master.json` → `master.json.enc`

> Note: the extension is **`.enc`** (encrypted container), not `.env`.
> The file starts with the 4 letters `MGR1`, then the lock data.

### How it was made

```bash
node Tools/build/encrypt-data.js <path>/master.json
node Tools/build/build-secure.js
```

1. `encrypt-data.js` creates `master.json.enc` next to the plain file, saves
   the key to `.secrets/data.key` (local only, never committed), and injects
   the same key into `secure.js` (replacing the `__SECURE_KEY__` placeholder).
2. `build-secure.js` then scrambles `secure.js` so the key inside it is not
   readable.

### Files needed to USE `master.json.enc` — checklist

**Must be present at runtime:**

| # | File | Why |
|---|---|---|
| 1 | `Private/Engine/_knowledge/json/master.json.enc` | the locked data |
| 2 | `Private/Bridge/secure.js` | holds the matching key; exports `readSecureText` / `readSecureJson` |
| 3 | `Private/Bridge/path.js` | the `DataFile()` / `MasterFile()` constants that say where the JSON folder is |
| 4 | `Private/Syllable/builder/_build.js` | `loadSyllablesData()` — reads the syllables when the tree is rebuilt |
| 5 | `Private/Syllable/helper/utilities.js` | `parseJson()` — general locked-JSON reader |

The `secure.js` file must be the one that was built **together with** this
`.enc` — a different `secure.js` carries a different key and will not open it.

**NOT needed at runtime:**

- Plain `master.json` — if a plain copy sits next to the `.enc`, the `.enc`
  wins and gets used.
- `.secrets/data.key` — only needed to re-encrypt or decrypt back.
- Extra npm packages — it uses Node's built-in crypto. (`bytenode` is only
  needed for the `.jsc`, and it is already in `package.json`.)

**Needed only for maintenance:**

- `Tools/build/encrypt-data.js` and `Tools/build/decrypt-data.js`, plus
  `.secrets/data.key`. If you lose the key inside `secure.js` **and** the
  sidecar file, the `.enc` can never be opened — keep backups of both.

### How the tree rebuild reads it (simple flow)

```
runBuild → loadSyllablesData(master.json)
        → sees master.json.enc next to it
        → asks secure.js to unlock it
        → gets the syllables
        → writes syllable.mapped.txt + tree files
```

### Test run — done today

- `readSecureJson` through `Private/Bridge/secure.js`: OK — top-level keys:
  `syllables, top, resolution, dictionary`
- `loadSyllablesData` with the explicit path: OK — **3,219 syllables** loaded
- The placeholder `master.json` inside the map dir is a sanitized stand-in —
  its content does **not** match what is inside the `.enc`.

---

## Watch-outs (small but important)

1. **JSON path mismatch in this repo.** `Private/Bridge/path.js` still points
   the *JSON* constants at the private layout
   (`ENGINE/Part/Engine/_knowledge/json`, `PDF/Python/File/.tree/`). Here the
   JSON lives at `Private/Engine/_knowledge/json`, so default-path calls (like
   `loadSyllablesData()` with no argument) fail with `ENOENT`. Pass the path
   explicitly, or update `DATA_DIR` in `path.js`. (The `.jsc` constant
   `JSC_FILE` now correctly points at the map dir.)
2. **Encrypt / build-secure paths.** Those two scripts target
   `ENGINE/Part/Bridge/secure.js` (private layout). In this repo the file is at
   `Private/Bridge/secure.js` — update the `SECURE_MODULE` constant in both
   scripts before running them here.
3. **POS build writes plaintext.** `runBuildPos()` in
   `Private/Syllable/builder/build.js` saves cleaned entries back to
   `master.json` as **plain text**, right next to the `.enc`. Delete or
   re-encrypt it after a POS build.
4. **Node version.** The committed `map-runtime.jsc` runs on Node v22.22.3
   only. Rebuild it on your deploy machine if your Node differs.
5. **Keep a readable copy of `secure.js`** (the one with the `__SECURE_KEY__`
   placeholder) somewhere safe — without it you cannot inject a new key later.

---

## Quick commands

```bash
# Rebuild the map binary — outputs land in Private/Syllable/mapper/map/
node Tools/build/build-bytecode.js

# Try the map binary (the way the engine uses it)
node --input-type=module -e "import * as m from './Private/Syllable/mapper/map/map-loader.js'; console.log(m.MyNormalize('ကတ်'))"

# Read the locked JSON (the way the engine uses it)
node --input-type=module -e "
import { readSecureJson } from './Private/Bridge/secure.js';
console.log(Object.keys(readSecureJson('Private/Engine/_knowledge/json/master.json')));"

# Unlock the JSON back to plain text (needs .secrets/data.key)
node Tools/build/decrypt-data.js Private/Engine/_knowledge/json/master.json.enc

# Re-lock it after editing (same key is reused from .secrets/data.key)
node Tools/build/encrypt-data.js Private/Engine/_knowledge/json/master.json
```

---

*Changes that came with this doc:*

- The placeholder map dir moved from `Tools/build/map/` to its original home:
  `Private/Syllable/mapper/map/` (its internal import paths were fixed for the
  new location).
- The loader `Private/Bridge/jsc.js` was renamed to
  `Private/Syllable/mapper/map/map-loader.js` and now resolves `map-runtime.jsc`
  **next to itself** (works from any cwd, no longer depends on `Bridge/path.js`).
- All importers were rewired to the new loader — including
  `Server/gateway/generator/string.js`, which previously pointed at the private
  layout (`ENGINE/Part/Bridge/jsc.js`) and was broken in this repo.
- `Tools/build/build-bytecode.js` used to call `Tools/create/...` scripts that
  don't exist here; it now finds its sibling scripts (`bundler.js`, `build.js`)
  next to itself, and **all three build scripts write their outputs into the
  map dir** — nothing lands at the repo root anymore.
- `.gitignore` covers the map-dir build intermediates
  (`bundle.js`, `actual.mjs`, `map-runtime.cjs`); only `map-runtime.jsc` is
  tracked.
