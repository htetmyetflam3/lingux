# Burmese damage repair (`repair_damage`)

Fixes the encoding damage left by the PDF-to-DOCX conversion of
`content/source/ယဲ့နင်.docx`, using the hand-made dictionary in
`Engine/knowledge/isTreasure/master.json` as the judge. Python and JavaScript
produce byte-identical output.

## What the conversion did

The vowel signs `ေ` (U+1031) and `ာ` (U+102C) were attached one consonant to the
left. `သဘော` never appears in the file; `သေဘာ` appears 254 times.

| correct | damaged | from the book |
|---|---|---|
| `သ ဘ ေ ာ` | `သ ေ ဘ ာ` | 254 |
| `အ တ ေ ာ ်` | `အ ေ တ ာ ်` | 99 |
| `သ ဘ ေ ာ ထား` | `သ ေ ဘ ာ ထား` | 67 |
| `သ လ ေ ာ က်` | `သ ေ လ ာ က်` | 40 |
| `အ ဖ ေ ာ ်` | `အ ေ ဖ ာ ်` | 13 |

The same four characters also appear in correct Burmese — `ရှိစေတာ့` is the
causative `စေ` plus `တာ့`, `ကေလာင်တံ` is a pen. The window alone decides
nothing, so every decision is anchored on the dictionary.

## Rules, in order

**1. Corrections** — reviewed literal fixes for damage the window rule cannot
see. Each one carries the number of occurrences seen in the book; a different
count is reported, never hidden.

| from | to | from the book |
|---|---|---|
| `ငေကာ` | `ကြော` | 261 |
| `မေကာက်` | `မကြောက်` | 9 |
| `သဘာကျ` | `သဘာဝကျ` | 2 |
| `သဘာတ၀ရား` | `သဘာဝတရား` | 1 |
| `သဘာအလှ` | `သဘာဝအလှ` | 1 |

**2. Digits** — the digit `၀` (U+1040) standing where the letter `ဝ` (U+101D)
belongs, repaired only when the letter makes a real word: `ဘ၀` → `ဘဝ`,
`သဘာ၀` → `သဘာဝ`, `လုံး၀` → `လုံးဝ`, `၀န်ကြီး` → `ဝန်ကြီး`. A digit next to
another digit (`၁၀၀`, `၅၀%`) is never touched.

**3. Windows** — `C1 ေ C2 ာ` becomes `C1 C2 ေ ာ` only when

* the text is not a protected word (`ကေလာင်` pen, `စေတာ`/`စေရာ` causative,
  `သေလား` dead-or-alive, `စာပေရောင်`);
* the damaged shape occurs in no dictionary entry — `စေကာ` sits inside
  `စေ  ကာ  မူ`, so `ဖြစ်စေကာမူ` is left alone;
* the text at that position is not already a real word;
* the repaired text is a real word, or a prefix of one that ends on a syllable
  boundary (`မေကာင်း` → `မကောင်း`, from `မ  ကောင်း  မှု`).

Anything else is left alone and counted.

Passes repeat until nothing changes (`--rounds`, default 3).

## Result on the book

```
content/source/ယဲ့နင်.txt  6,358,707 -> 6,358,743 bytes, 59,879 lines, 197 markers
sha256 b21e2bbfb124a84888144e19084254a4855f022e2b0efaafa10013ff3f0ddffa

round 1: 2375 repairs (corrections 274, digits 161, windows 1940)
round 2: 0 repairs  -> converged
skipped: protected 34, shape_is_attested 2613, damaged_is_word 0, no_anchor 1292
```

| word | before | after |
|---|---|---|
| `သဘော` | 0 | 254 |
| `သေဘာ` | 254 | 0 |
| `သဘာဝ` | 139 | 162 |
| `ကြောင်း` | 373 | 448 |
| `ငေကာင်း` | 75 | 0 |
| `မကောင်း` | 0 | 263 |
| `မေကာင်း` | 263 | 0 |
| `ဘဝ` | 275 | 323 |
| `ဘ၀` | 48 | 0 |
| `ကေလာင်` (pen) | 9 | 9 |
| `စေတာ့` | 12 | 12 |

Tagger on the repaired text: unknown tags `106,612 → 103,995`, `သေ{n} ဘာ{aj,pn}`
`254 → 0`, `သဘော` emitted as one word 47 times, `အကောင်း` 213 times. The 1,214
rejected dictionary entries do not change — those are Pali and stacked-consonant
syllables missing from the syllable map, a different fault.

## Usage

```sh
# Python
python3 format/repair_damage.py content/source/ယဲ့နင်.txt --dry-run
python3 format/repair_damage.py content/source/ယဲ့နင်.txt            # -> <stem>.damage-repaired.txt
python3 format/repair_damage.py content/source/ယဲ့နင်.txt --in-place --report /tmp/report.json

# JavaScript (same rules, same bytes)
node format/repair_damage.mjs content/source/ယဲ့နင်.txt --dry-run
node format/repair_damage.mjs content/source/ယဲ့နင်.txt -o out.txt --verify out-python.txt

# during DOCX extraction
python3 format/docx_text.py --force --repair-damage
```

Options: `--rounds N`, `--no-ledger`, `--ledger PATH`, `--master PATH`,
`--report PATH`, `--dry-run`, `--in-place`, `-o PATH`.

## The ledger

`format/damage_ledger.json` holds the reviewed exceptions, each with the reason
and the number of occurrences found in the book:

```json
{
  "protected":  [{"word": "ကေလာင်", "reason": "..."}],
  "corrections": [{"from": "ငေကာ", "to": "ကြော", "expected": 261, "reason": "..."}]
}
```

`--no-ledger` runs the general rules only, which is what you want for a
different book.

## Limits

Only the damage seen in this book is repaired. The file still contains other
PDF faults this tool deliberately does not touch: `ြွ` insertions
(`ကေတြွာ့`), dropped `ြ` elsewhere, and a name spelled `ဝေ့၀ူ`. They are left
as they are and are not silently rewritten.
