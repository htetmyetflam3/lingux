# linga / `architecture` — probe result (2026-10-21)

Cloned `htetmyetflam3/linga` branch **`architecture`** (`57c7742`), `npm install`,
`Lexical_No_inspect/` never opened, no engine file edited.

## How it was run (full path, no shortcut)

The branch keeps its File paths absolute (`/File/...`), so:

```bash
sudo mkdir -p /File/input /File/.tree /File/.output/txt /File/.output/.log
# input at /File/input/input.txt
cd linga && node init/cli.js          # configure → runBuild → runBuildPos → segmentor
                                      # → tagger → rule engine → bridge → read-back
```

`WRITE_POS=false` in `../.env` gives the syllable-only pass through the same entry.

## What the segmentor does (syllable-only, tagger never built)

| input | units | verdict |
|---|---|---|
| `သူ့` | `သူ့` | ok |
| `သင့်` | `သင့်` | ok |
| `ပြည့်` | `ပြည့်` | ok |
| `ကြောင့်` | `ကြောင့်` | ok |
| `နှင့်` | `နှင့်` | ok |
| `ကျောင်း` | `ကျောင်း` | ok |
| `ရှန်း` | `ရှ` `န်` `း` | loan/unknown syllable |
| `ဗုဒ္ဓ` | `ဗု` `ဒ` `္ဓ` | loan |
| `ခန္ဓာ` | `ခ` `န` `္ဓ` `ာ` | loan |
| `အင်္ဂလိပ်` | `အ` `င` `်္` `ဂ` `လိပ်` | loan (kinzi) |

Grouping is right — the "99.9% except loan words" claim holds. The failure is
after segmentation.

## Root cause: emitted surface is in the wrong mark order for `င့်`/`ည့်`

The same id is spelled two ways:

```
table  A190   ... 1004 103A 1037      (asat then dot)  ← syllable.mapped.txt
walker        ... 1004 1037 103A      (dot then asat)  ← toBurmeseStr()
```

`burmeseToId()` looks the walker's string up in the table:

```
node --input-type=module -e 'import {burmeseToId} from "./MonoSyllabism/generators/idmap.js";
console.log(burmeseToId("က\u103c\u1031\u102c\u1004\u103a\u1037"),   // A190
            burmeseToId("က\u103c\u1031\u102c\u1004\u1037\u103a"))' // null
```

Smallest repro of the producer side:

```
toBurmeseStr("A¢∆¼E¿^")  →  ကြောင့်  [1000 103C 1031 102C 1004 1037 103A]
table row A190 burmese   →  ကြောင့်  [1000 103C 1031 102C 1004 103A 1037]
```

So `an` id that is in the tree (`A190` root exists in `pos.tree.json`) can
never be reached: the tagger resolves `null` and prints `{?}`. Nothing is
missing from the dictionary for these words — the lookup string is.

### Cost on real text (chapter 1 + 2, full pipeline)

| chapter | tokens | `{?}` | after canonicalising `U+1037 U+103A` → `U+103A U+1037` |
|---|---|---|---|
| ch01 | 1,621 | 230 (14.19%) | 130 (8.02%) — 100 tokens recovered |
| ch02 | 1,835 | 289 (15.75%) | 128 (6.98%) — 161 tokens recovered |

The remainder is loan clusters (`ကမ္ဘာ`, `ခန္ဓာ`, `ကြမ္မာ`, `ဗုဒ္ဓ`), unmappable
`ဧ`/`ရာဇ်` shapes, the entry-less `သူ့`, and punctuation (`၊`, quotes, `…`).

## Second finding: the build deletes dictionary entries

`runBuildPos()` reports `Failed: 1214` and then **rewrites
`knowledge/isTreasure/master.json`**, dropping those entries
(30,367 → 29,153 per run). Failures are all loan clusters:

```
[aj] "စ  တု  တ္ထ" | missing: တ္ထ
[aj] "ဒေ  သ  န္တ  ရ" | missing: န္တ
```

`ကမ္ဘာ` is already absent from `HEAD:master.json` (`ကမ္ဘ` = 0 hits), so at least
one earlier run has already eaten it. Every run shrinks the readable
dictionary a little more; the tree keeps only what survived.

## Minimal fixes (not applied)

1. `MonoSyllabism/generators/idmap.js` — canonicalise before lookup:
   `_burmeseToId.get(s) ?? _burmeseToId.get(s.replace("\u1037\u103a", "\u103a\u1037"))`
2. Or make `toBurmeseStr` emit `^¿` for that pair, so producer and table agree.
3. Stop `runBuildPos` from rewriting `master.json`; write the pruned copy to
   the tree dir instead. Otherwise the source of truth erodes.

Fix 1 alone takes the two chapters from ~15% unknown to ~7–8%.

## 2026-10-22 — what was copied, what was patched, what needed no rebuild

Compared against `linga@57c7742` (`architecture`) with `diff -rq`:

| path | difference | action |
|---|---|---|
| `MonoSyllabism/graph/build.js`, `shape.js` | none | nothing to copy — the tree builder **is** linga's |
| `MonoSyllabism/graph/disassembler.js` | `export const POS_MAP` | keep: `Engine/export-comparison-data.mjs` imports it |
| `MonoSyllabism/main/grapheme/Tree.loaded.js` | none in linga — the Pali defect is in **both** | patched here: read every list under `syllables` |
| `generators/idmap.js`, `generators/input.js`, `utilities/formatter.js`, `map/loader.js` | local fixes for mark order and the WASM runtime | unchanged |

So "copy the tree builder from linga" would have copied the bug: `graph/` was
already in sync, and the defect was in the syllable loader two directories
away. `Tree.loaded.js` stopped at the end of the `burmese` array, so
`syllables.pali` never reached `runBuild()` even though the builder itself was
fine.

The WASM needed no rebuild. Its payload decrypts to exactly the four
`mapbuilder/base` modules and the `mapData` tables that are on disk
(`node scraper/wasm/box/tools/verify-payload.mjs` → all `ok`). The tree is
data outside the capsule, so a tree fix is a data change.
