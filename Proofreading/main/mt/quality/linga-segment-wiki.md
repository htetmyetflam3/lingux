# linga `architecture` — segmentor test on real Wikipedia prose

Branch `57c7742`, full entry `node init/cli.js`, `WRITE_POS=false` (syllable-only
pass, tagger never constructed). Input: the မြန်မာစာ Wikipedia paragraph
(markdown link wrappers removed, prose untouched).

## Raw syllable output

```
မြန်  မာ  စာ  စ  တင်  ဖြစ်  ပေါ်  လာ  ခြင်း  သည်  မြန်  မာ  သည်  ပျူ  စာ  ရေး  နည်း  ကို
စံ  တင်  ပြီး  (  ၁  ၂  )  ရာ  စု  တွင်  မြန်  မာ  ဘာ  သာ  ပေါ်  ထွန်း  လာ  ခဲ့  ခြင်း  ဖြစ်  သည်  ။
မြန်  မာ  နိုင်  ငံ  စ  တင်  တည်  ထောင်  စဉ်  ကာ  လ  အ  နော်  ရ  ထာ  မင်း  ၏  လက်  ထက်  တွင်
သ  ဣ  တ  ဘာ  သာ  စာ  ဖြင့်  ရေး  သော  အုတ်  ခွက်  စာ  များ  ၊  ပါ  ဠိ  စာ  များ  ဖြင့်  ရေး  သော
အုတ်  ခွက်  စာ  များ  ကို  အ  ထောက်  အ  ထား  ပြု  ကာ  မြန်  မာ့  တို့  သည်  မူ  လ  က  ပါ  ဠိ  နှင့်
သ  ဣ  တ  ဘာ  သာ  တို့  ကို  ရင်း  နှီး  ခဲ့  ကြောင်း  သိ  ရ  သည်  ။  သ  ဣ  တ  ဘာ  သာ  သည်
မ  ဟာ  ယာ  န  ဗု  ဒ  ္ဓ  ဘာ  သာ  နှင့်  ဆက်  နွယ်  ပြီး  ပါ  ဠိ  ဘာ  သာ  သည်  ထေ  ရ  ဝါ  ဒ
ဗု  ဒ  ္ဓ  ဘာ  သာ  နှင့်  နှီး  နွယ်  ကြောင်း  သိ  ရ  သည်  ။
```

## Byte check

417 non-space input characters → 411 output. The entire difference is three
replacements of `က္က` → `ဣ` (6 chars → 3 chars). No character is dropped,
reordered or duplicated anywhere else. Every space-separated word reconstructs
exactly from its segments.

## The three `ဣ` are not the segmentor

`normalize()` runs `cleanImposters()` **before** the segmentor, driven by
`master.json → mapData.IMPOSTER`:

```
"ဣ": { "correct": "ဣ", "imposters": ["က္က"] }
```

```
normalize("သက္ကတ")  →  "သဣတ"
```

`က္က` is a legitimate Pali conjunct (it is listed in `syllables.pali`), so this
entry rewrites a valid cluster into a vowel letter and the segmentor then cuts
the wreck. This is a data rule, in `mapData`, not a walker bug.

## Loan clusters: every `္` stack splits

```
ဒုက္ခ        → ဒု · က · ္ခ
သင်္ချာ      → သ · င · ်္ · ချာ
ဗုဒ္ဓ        → ဗု · ဒ · ္ဓ
သဒ္ဒါ       → သ · ဒ · ္ဒ · ါ
ကမ္မဋ္ဌာန်း → က · မ · ္မ · ဋ · ္ဌ · ာ · န် · း
ဝိပဿနာ     → ဝိ · ပ · ဿ · နာ      ← ဿ is a real unit, survives
```

`္ခ`, `္ဓ`, `္ဒ`, `္ဌ`, `္မ`, `က္က` are all in `master.json → syllables.pali`
(732 entries) but **none of them is in `syllable.mapped.txt`**. The build reads
only the `burmese` array:

```js
if (/^"burmese"\s*:\s*\[\s*$/.test(trimmed)) collecting = true;   // Tree.loaded.js
```

So the Pali inventory never reaches the tree, the segmentor has no unit for a
virama stack, and it falls back to one mark at a time.

## Verdict

| area | result |
|---|---|
| native clustering | clean — မြန်မာ, နိုင်ငံ, အနော်ရထာ, လက်ထက်, အထောက်အထား, ရင်းနှီး, ကြောင်း, ဆက်နွယ်, မဟာယာန, ထေရဝါဒ all cut right |
| character preservation | exact |
| loan words | split at every `္` — one cause: Pali units never merged |
| `သက္ကတ` | rewritten by the `က္က → ဣ` imposter rule before segmentation |

Two data fixes, no walker change:

1. drop or narrow the `က္က → ဣ` imposter entry
2. merge `syllables.pali` into the syllable lookup that `runBuild` consumes

## Status 2026-10-22 — fix 2 is in; fix 1 is still open

`Tree.loaded.js` now reads every list under `syllables`, and the cache was
rebuilt from the sealed master. Burmese is read first, so no existing id moved.

| | before | after |
|---|---|---|
| units in `syllable.mapped.txt` | 2,521 | 3,229 |
| dictionary entries reachable | 29,151 | 29,571 |
| entries blocked at POS build | 1,216 | **0** |
| `ဗုဒ္ဓ` | `ဗု · ဒ · ္ဓ` | `ဗု · ဒ္ဓ` — one token `ဗုဒ္ဓ{n}` |
| `ဒုက္ခ` | `ဒု · က · ္ခ` | `ဒု · က္ခ` — one token `ဒုက္ခ{n}` |
| `ခန္ဓာ` | `ခ · န · ္ဓ · ာ` | `ခ · န္ဓာ` — one token `ခန္ဓာ{n}` |

Old ids are byte-identical for all 2,521 shared units; the rebuild only adds.
`သက္ကတ` still comes out `သ · ဣ · တ`, because that one is the `က္က → ဣ`
imposter rule, not the inventory. Fix 1 (narrowing `IMPOSTER`) is untouched: it
is deliberate data in `mapData`, and the owner's instruction is that the mark
order and `mapData` stay as shipped.
