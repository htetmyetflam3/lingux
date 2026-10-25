# CHANGELOG

## [0.7] - 2026-09-21

### Added
- `Bridge/api-server.js` is now the production express stage: `createApp()`/`startServer()` exports, `node Bridge/api-server.js` / `npm run api` boots it on `0.0.0.0:${PORT:-9000}`. Same routes as before (GET /health open; POST /fsm, POST /process, GET /result/:hash behind the fail-closed key+IP+origin gate), express plumbing, body-cap 400s, JSON parse-error middleware.
- `MonoSyllabism/generators/idmap.js` — the ASCII↔Burmese↔ID converter tables resurrected at the generator seat (old `map/base/idmapper.js` was deleted); rows read through `Tree.loaded.loadMappedRows`, all four lookups exported.

### Changed
- Import paths follow the renamed layout: `knowledge/library/*` → `MonoSyllabism/utilities/*`; `S.loaded.js` → `Tree.loaded.js`; `Bridge/endofmain.js` → `Bridge/Ginit.js`; `init/Syllable.initS.js` → `init/cli.js`; `init/Ginit.js` → `init/initS.js`; normalizer → `generators/input.js`; `fullstopHolder` → `generators/pos-input.js`; `toLineStrings` → `generators/SfomatterForP.js`.
- The engine kick is inlined in `init/cli.js` (`runSegmentor(readAndPrepare(...))`) — the deleted `phoneme/init.js` stays deleted.

### Removed
- `option.js` (the CLI adapter) and every `argv` read in the engine entry — the architecture branch is API-only; CLI input lives on the dev branch.
- Test/experimental leftovers in `Bridge/Ginit.js` (unused fs/url imports).

### Noted
- Map build artifacts + `.secrets` keys are committed in this push, intentionally (owner will delete manually later).


## [0.6] - 2026-09-20

### Added
- `knowledge/library/` reorganized into one module per pipeline event: `formatter.js` (line/token formatting + the √ and `<eos>` contracts + positional `isBase`/`toPositions`), `disk.js` (session hash, `createStreamWriter`, tree writers, fs helpers), `generator.js` (`fullstopHolder` moved out of `Bridge/bridge.js`, `toLineStrings`), `buffer.js` (`splitBuffer`, `getReadChunkSize`, `getFlushLines`), `stream.js` (`collector`, `readFileContent`).
- Inline formatting extracted from the segmentor and tagger: `lexer.js` now emits through `toSyllableToken`/`SPACE_TOKEN`; `phonology.js` uses `splitSyllables`/`asEos`/`mergedIds`, and `runBuildPos`/`endofmain.js` merge ids via `mergedIds`.

### Changed
- Number classification lives only in `MonoSyllabism/main/phoneme/classify-number.js` (the inline copy in `phonology.js` is deleted).
- `S.loaded.js` keeps tree/loading only; its duplicated `splitBuffer`/size tables moved to `buffer.js` (`bridge.js` and readers import from there).
- `.gitignore`: regenerable map artifacts (`payload.jsc`, `loader.js`, `secure.js`, `*.enc`) and `mapbuilder/.secrets/` are ignored (rebuild with the two `mapbuilder` scripts).

### Fixed
- `S.loaded.streamSyllables`/`_extractSyllables` read both master.json syllable shapes (`"syllables": [...]` and `"syllables": { "burmese": [...] }`) through one shared line loop; the runBuild phase no longer fails on the nested shape.
