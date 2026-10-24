# Confirmation: the Pali syllable list exists and the tree builder never reads it

Branch `architecture` @ `57c7742`. Two facts, each with a direct command.

## Fact 1 — `syllables.pali` exists in `master.json`

```console
$ python3 -c 'import json; s=json.load(open("knowledge/isTreasure/master.json"))["syllables"]; print(type(s).__name__, list(s), len(s["burmese"]), len(s["pali"]))'
```

```
dict  ['burmese', 'pali']  2483  732
```

Probe units:

| unit | in `burmese` | in `pali` |
|---|---|---|
| `န္ဓာ` | no | **yes** |
| `ဒ္ဓ` | no | **yes** |
| `က္က` | no | **yes** |
| `က္ခ` | no | **yes** |
| `တ္တ` | no | **yes** |
| `မ္ဘ` | no | **yes** |
| `လ္လ` | no | **yes** |
| `န္တ` | no | **yes** |
| `ဋ္ဌ` | no | **yes** |

The sealed runtime copy (`MonoSyllabism/map/master.json.enc`) carries the same
object — `burmese: 2483`, `pali: 732`, including `န္ဓာ` and `က္က`. The data is
not lost in sealing.

## Fact 2 — the builder reads only `burmese`

`MonoSyllabism/main/grapheme/Tree.loaded.js:102-123`, the single loader used by
`runBuild()`:

```js
async function* _syllablesFromLines(lines) {
  let inSection = false;
  let collecting = false;
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!inSection) {
      const m = trimmed.match(/^"syllables"\s*:\s*([\[{])/);
      if (m) {
        inSection = true;
        collecting = m[1] === '['; // bare array opens the list at once
      }
      continue;
    }
    if (!collecting) {
      if (/^"burmese"\s*:\s*\[\s*$/.test(trimmed)) collecting = true;   // ← only this key
      continue;
    }
    if (trimmed === ']' || trimmed.startsWith('],')) break;             // ← stops at the end of burmese
    ...
```

`"pali"` appears nowhere in the file, and `grep -rn pali --include=*.js .`
(excluding `Lexical_No_inspect/`) returns **nothing**. The array is never read by
any code path.

Empirical confirmation — call the loader the build calls:

```console
$ node --input-type=module -e 'import {loadSyllablesData} from "./MonoSyllabism/main/grapheme/Tree.loaded.js";
const l = await loadSyllablesData(); console.log(l.length, l.includes("န္ဓာ"), l.includes("က္က"));'
```

```
2483   false   false
```

2483 is exactly the `burmese` length. The 732 Pali units are absent.

Note the runtime path: `MasterFile()` returns `MonoSyllabism/map/master.json`,
and `streamSyllables()` decrypts `master.json.enc` when that twin exists — so a
fix must re-seal with `MonoSyllabism/mapbuilder/encrypt.json.js`, not just edit
`knowledge/isTreasure/master.json`.

## Causation test (throwaway copy at /tmp, repo untouched)

Patched `_syllablesFromLines` to accept both keys → `loadSyllablesData()` returns
**3215** units (2483 + 732). Same input, same entry point:

| input | unpatched | patched |
|---|---|---|
| `ဒုက္ခ` | `ဒု · က · ္ခ` | `ဒု · က္ခ` |
| `သင်္ချာ` | `သ · င · ်္ · ချာ` | `သ · င်္ချာ` |
| `ဗုဒ္ဓ` | `ဗု · ဒ · ္ဓ` | `ဗု · ဒ္ဓ` |
| `သဒ္ဒါ` | `သ · ဒ · ္ဒ · ါ` | `သ · ဒ္ဒါ` |
| `ကမ္မဋ္ဌာန်း` | `က · မ · ္မ · ဋ · ္ဌ · ာ · န် · း` | `က · မ္မ · ဋ္ဌာ · န် · း` |
| `ဝိပဿနာ` | `ဝိ · ပ · ဿ · နာ` | `ဝိ · ပ · ဿ · နာ` (unchanged) |

On the Wikipedia paragraph: 158 units → 156, character-exact preserved, every
`ဗုဒ္ဓ` becomes `ဗု · ဒ္ဓ`.

`သက္ကတ` stays `သ · ဣ · တ` in both runs — because that one is rewritten by
`mapData.IMPOSTER[ဣ].imposters = ["က္က"]` *before* segmentation. Two independent
causes, confirmed as independent.

## Fixed 2026-10-22

`_syllablesFromLines` now streams every list under `"syllables"` — not just the
first — and `Engine/.cache-tree/` was rebuilt from the sealed master. Burmese
is still read first, so every existing id is unchanged (verified: 2,521 shared
units, 0 id changes) and the 732 Pali units are appended after it.

```
$ node --input-type=module -e 'import {loadSyllablesData} from "./Engine/MonoSyllabism/main/grapheme/Tree.loaded.js"; const l = await loadSyllablesData(); console.log(l.length, l.includes("န္ဓာ"), l.includes("က္က"));'
3215   true   true
```

| | before | after |
|---|---|---|
| units | 2,521 | 3,229 |
| blocked dictionary entries | 1,216 | 0 |
| `ဗုဒ္ဓ` | `ဗု · ဒ · ္ဓ` | one token, `ဗုဒ္ဓ{n}` |

`Engine/CACHE-SOURCE.json` records the rebuild and the new hashes; `tag-text.mjs`,
`tag-both.mjs` and `units.mjs` verify against it, so a stale cache now fails loudly.
