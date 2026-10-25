# Bridge/Engine — engine entry APIs (drafts)

Boundary entries through which the **scraper** calls the standalone syllable
engine. The inline `Scraper/Engine/` copy (MonoSyllabism + Bridge shims +
`.cache-tree`) was removed in the lingux reorg; the engine's home is
`Engine_host/`. These drafts pin the exact call contracts the scraper already
depended on, so the later wiring only retargets imports — no protocol redesign.

## Drafts

| File | Replaces (deleted) | Runtime entry protocol |
|---|---|---|
| `segment-bridge.draft.mjs` | `Scraper/main/support/segment_bridge.mjs` + the four engine modules it imported | Node 22+ subprocess. stdin = documents joined by `U+001D`; `argv[2]` = output file; output = segmented documents joined by `U+001D`. stdout/stderr stay diagnostic only (engine logger badges). |
| `engine-ready.draft.py` | `Scraper/deploy/engine_ready.py` | systemd `ExecStartPre` preflight: find Node ≥22, verify engine artifacts + precomputed tree, boot the bridge with empty input, optional `--fix` rebuild. |

## Engine API surface the drafts expect from Engine_host

1. `TreeFile()` — directory of the precomputed syllable tree
   (was `Engine/Bridge/path.js`; tree cache must exist and be non-empty).
2. `mapperNormalize(text)` — **default export** of the map loader
   (was `Engine/MonoSyllabism/map/loader.js`); mark reordering happens inside
   normalize; English/digit blocks survive wrapped, never deleted.
3. `runSegmentor(lineAsyncGenerator)` — async token generator, one token per
   syllable, `"\n"` tokens pass through (was `main/phoneme/lexer.js`).
4. `toSyllableLine(line)` — formatter that consumes the segmentor's
   √-suffixed internal handoff and emits the final delimiter-joined line
   (was `utilities/formatter.js`).

## Scraper callers that must be retargeted here (left in place, now dangling)

- `Scraper/main/modules/result/text_collect.py` — `_find_node22()` then
  `subprocess.run([node, BRIDGE_SCRIPT, out_path], input=docs)`
- `Scraper/deploy/continuous-ocr/run.py` — same bridge spawn after OCR
- `Scraper/deploy/engine_ready.py` — preflight (replaced by the python draft)
- `Scraper/parse.py` — required-files list mentions the old Engine paths

`wasm/box` is **not** part of this boundary: it is the engine's sealed
packaging build, unique to the scraper tree, and stays under `Scraper/wasm/`.
