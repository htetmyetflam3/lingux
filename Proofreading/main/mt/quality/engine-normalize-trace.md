# Trace: why segmentation breaks in `proofreading` but not in `linga`/architecture

Question asked: did an agent corrupt `normalize` (lowercase `e` vs uppercase `E`)?
Answer: **no. `normalize` is untouched. The call site in `generators/input.js`
calls the wrong composite, and the reorder step inside it flips the mark order
that `mapperStr` depends on.**

## 1. The map code is byte-identical in both checkouts

```
Engine/MonoSyllabism/mapbuilder/base/function.js      SAME (sha256 matches build-info.json)
Engine/MonoSyllabism/mapbuilder/base/normalize.js     SAME (sha256 matches build-info.json)
Engine/MonoSyllabism/mapbuilder/base/sourceMap.js     SAME (sha256 matches build-info.json)
Engine/MonoSyllabism/mapbuilder/base/sourceMapper.js  SAME (sha256 matches build-info.json)
Engine/knowledge/isTreasure/master.json               SAME (sha256 matches build-info.json)
```

All five inputs match the hashes recorded in `scraper/wasm/box/build-info.json`,
which means the WASM box was built from exactly the files on disk — and those
files are byte-identical to the `architecture` branch. `normalize()` output is
identical in both checkouts for every probe.

## 2. The difference is which function `readAndPrepare` calls

| checkout | `generators/input.js` |
|---|---|
| `linga` architecture | `normalize(block)` → `mapperStr(cleaned)` |
| `proofreading` | `mapperNormalize(block)` |

`mapperNormalize` is `normalize` **→ `reorderAndWrap` →** `mapperStr`
(`normalize.js`). The extra step is the whole bug.

## 3. Step-by-step, using the base sources directly

Input `သင့်` — 4 code points. Both spellings tested.

```
input            သ င ် ့           101E 1004 103A 1037
  normalize      သ င ့ ်           101E 1004 1037 103A     ← dot before asat
  reorderAndWrap သ င ် ့           101E 1004 103A 1037     ← flipped back
  mapperStr(norm)  "YE¿^"                                  ← correct, what the tree holds
  mapperStr(reord) "Ye¿"                                   ← lowercase e, caret lost
```

`reorderAndWrap` sorts marks with `mapData.Priority`:

```
U+103A ် asat      priority 14
U+1037 ့ dot       priority 15     → asat sorts before dot
U+1038 း visarga   priority 16
U+1036 ံ anusvara  priority 13
```

And `compose()` (`function.js`) has this rule:

```js
/([A-Z])\^\$|\$([A-Z])|\$([a-z])|\$([^A-Za-z])|([A-Z])\^/g
...
if (upper) return String.fromCharCode(upper.charCodeAt(0) + 32);
```

`X^` means "base + asat" and becomes the lowercase tail token `x`. So when
reorder puts `်` immediately after `င`, `E^` collapses to `e` and the dot `့` is
left stranded: `YE¿^` → `Ye¿`.

The POS tree is built with `buildSyllableLookup()`, which maps each syllable
through `MyNormalize` = `normalize` → `deleteEnglishBlocks` → `mapperStr` — no
reorder. So the tree holds `YE¿^` while the segmentor is fed `Ye¿`. No match →
one mark per token.

## 4. Measured end to end (chapters 1–2, same tree, same segmentor)

| encoder | ch01 mark-fragments | ch02 mark-fragments |
|---|---|---|
| `mapperNormalize` (current) | 111 / 2080 = 5.34% | 136 / 2354 = 5.78% |
| `normalize` + `mapperStr` (linga) | 63 / 2025 = 3.11% | 62 / 2280 = 2.72% |
| `mapperNormalize` with Priority swapped | **63 / 2031 = 3.10%** | **62 / 2281 = 2.72%** |

POS `{?}` barely moves (13.7% / 15.0% → 13.7% / 15.3%) because those leftovers
are dictionary gaps (`ကမ္ဘာ`, `ခန္ဓာ`, `ဧ`, `၏` standalone-id mismatch, loan
stacks) — a different cause from this one.

## 5. Why the agent changed it (and why reverting alone is not enough)

`normalize + mapperStr` leaves Latin/digit blocks unmasked, and `mapperStr` maps
`A–Z` onto Burmese bases — "Hello 123" becomes `ညင် ဏ် ဏ် ဒ်` garbage.
`reorderAndWrap` is what wraps English into `{...}` blocks. So the intention was
right; the composite was wrong.

Two ways out, both keep the masking:

1. **Swap the two Priority values** (`့` → 14, `်` → 15) so `reorderAndWrap`
   preserves the order `compose()` expects. Verified:

   ```
   mapperNormalize("သင့်")          → "YE¿^"
   mapperNormalize("Hello 123 သင့် ok") → "{Hello} {123} YE¿^ {ok}"
   ```

   Cost: `Priority` lives in `master.json → mapData`, which is sealed into the
   WASM box — needs a re-seal/rebuild, not a text edit.

2. **Keep `input.js` on `normalize + mapperStr`** for Burmese lines and mask
   Latin blocks before mapping. No box rebuild, but changes `input.js`.

## 6. What could not be verified

`Engine/MonoSyllabism/generators/input.js` has exactly one commit in this
checkout (`f50a1d6`, a squashed merge), so there is no history to name the commit
or author that introduced `mapperNormalize`. The content difference against the
architecture branch is the evidence, not a blame trail.

## 7. Fix applied (2026-10-22)

`Priority` is untouched — the dot-below stays last, exactly as intended.
Three edits, all outside the sealed box:

**`Engine/MonoSyllabism/generators/input.js`** — `mapperNormalize(block)` is
replaced with `mapperStr(maskBlocks(normalize(block)))`. The English/digit
masking that `reorderAndWrap` used to provide is done by a local `maskBlocks()`
(identical wrap rule, no mark reordering). The encoder now emits `YE¿^`, the
shape the tree was built with.

**`Engine/MonoSyllabism/utilities/formatter.js`** — `houseOrder()` rewrites
`U+1037 U+103A` back to `U+103A U+1037` in the three output formatters
(`toSyllableLine`, `toBurmeseLine`, `toBurmeseLineWithPos`). Presentation only:
matched tokens come back in NFC order because the tree was built that way, and
this restores the house order on the way out. Nothing upstream changes.

**`Engine/MonoSyllabism/generators/idmap.js`** — `burmeseToId()` keys both the
table and the lookup through the same order canonicalisation. Without it a
matched `သင့်` still printed `{?}`, because the mapped table stores the house
order while the encoder handed back NFC order.

### Result, chapters 1–2, full tagger path

| | before | after |
|---|---|---|
| ch01 units | 2080 | 2031 |
| ch01 mark-fragments | 111 (5.34%) | **63 (3.10%)** |
| ch02 units | 2354 | 2281 |
| ch02 mark-fragments | 136 (5.78%) | **62 (2.72%)** |
| ch01 `{?}` | 228 / 1659 (13.7%) | **179 / 1591 (11.3%)** |
| ch02 `{?}` | 283 / 1891 (15.0%) | **208 / 1799 (11.6%)** |

Probe, one line each, both input orders:

```
သင့်  (U+103A U+1037 in)  →  သင့်{v,p}   U+103A U+1037 out
သင့်  (U+1037 U+103A in)  →  သင့်{v,p}   U+103A U+1037 out
ကြောင့် နှင့်            →  ကြောင့်{w}  နှင့်{w,cn,p}
Hello 123 သင့် ok        →  Hello{?}  123{count}  သင့်{v,p}  ok{?}
```

`mt/tests`: 93 OK.

### What is left, and it is not this bug

`{?}` still ~11% — `ဧ`/`ရာဇ်` (not in the unit table), loan stacks
(`္ဘ`, `္တ`), `သူ့` (tree root `Y452` carries an empty tag list), `၏` (mapped to
`π002`, tree only has `π003`), punctuation, and the Zawgyi-order source damage
(`ယေန့`, `အေခြအေန`) that no encoder can repair.
