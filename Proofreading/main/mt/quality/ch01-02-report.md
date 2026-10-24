# Archived notes on the human reference, chapters 1–2

> **Caution:** API-generated Burmese text has been removed from the current
> workflow. This file is an older analysis of the human Burmese reference only;
> it is not an AI-translation baseline. The reference has known encoding damage,
> so its spelling, grammar, and stylistic details are uncertain. Use it only as
> contextual evidence and verify interpretations against the Chinese.

## Which text this report is about

| name | where | nature |
|---|---|---|
| **Human reference** | `content/merged/episodes.docx`, chapters 1–2 | PDF→DOCX Burmese with encoding damage; contextual evidence only |
| **English** | `content/mtranslate/zh-en.txt` | local Chinese → English reading aid |
| **API English** | `content/mtranslate/english.txt` | retained API translation; unrelated to this archived Burmese analysis |
| **Burmese API output** | removed | no current baseline |

This archived report measures the **human reference only**. Its statistics and
examples should not be treated as a reliable style, spelling, or grammar oracle;
known PDF/extraction encoding damage may distort them. Do not use this file to
recreate or judge deleted API-generated Burmese text.

Measured with the repository's own engine (`Engine/tag-text.mjs` path, POS tree
from `master.json`, `syllable.mapped.txt` inventory) after the encoder fix in
`4da54c8`, plus the rules in `mt/quality/profile.py`.

---

## 1. Headline numbers

| | chapter 1 | chapter 2 |
|---|---|---|
| Chinese source | 74 sentences / 1,784 chars | 71 sentences / 1,625 chars |
| Burmese | 89 sentences / 1,591 words / 2,031 units | 66 sentences / 1,799 words / 2,281 units |
| expansion vs Chinese | 3.46× | 4.34× |
| sentence length (median / p90) | 18 / 31 words | 27 / 40 words |
| known-word rate | 88.7% | 88.4% |
| mark-fragments (split clusters) | 63 / 2,031 = 3.1% | 62 / 2,281 = 2.7% |
| confirmed encoding damage | 15 sites | 4 sites |
| trailing-space lines | 171 / 172 | 189 / 194 |

Expansion of 3.5–4.3× over Chinese is normal for Burmese and matches the
length of the sentence in the sample below; nothing suggests truncation.

## 2. What the reference does right

These are the properties an agent must preserve, not "improve":

**Orthography is clean at the cluster level.** After the encoder fix, 96.9% of
units match the dictionary or the syllable inventory. The fragments that remain
are almost entirely loan clusters (`္ဘ`, `္မ`, `္တ`) whose Pali units are missing
from the lookup — an engine gap, not a text defect.

**Register discipline is the strongest signal in the corpus.** Narration is
consistently formal written Burmese; dialogue is consistently colloquial. There
is **not one mixed-register sentence in either chapter**:

| | formal (`သည်/မည်/၏/ပါသည်`) | colloquial (`တယ်/ပေါ့/မယ်/လား/ပဲ`) | neither |
|---|---|---|---|
| ch1 | 55 (62%) | 3 (3%) | 31 (35%) |
| ch2 | 56 (85%) | 0 (0%) | 10 (15%) |

The "neither" bucket is not a defect — it is narration that ends on a noun,
a copula-less clause, or an ellipsis (`…`), which is idiomatic.

**Dialogue particles are used correctly.** Every quoted span closes with a
colloquial particle or an address particle, never with `သည်`:

```
“ဒီတော့ ငါဒီလိုပဲ ဘ၀ကူးလာတယ်ပေါ့”
“ဒါက စာမဖွဲ့လောက်ပါဘူး”
“ငါတရားရုံးကိုမသွားချင်ဘူး၊ နန်းတော်ကိုပဲ သွားမယ်”
“သက်သောင့်သက်သာနေကြပါ”
```

**Particle inventory is stable and formal-leaning**, which is what a
historical-fantasy register needs:

| marker | ch1 | ch2 |
|---|---|---|
| `၏` (formal possessive) | 21 | 33 |
| `ရဲ့` (colloquial possessive) | 0 | 0 |
| `ကို` (object) | 38 | 47 |
| `တွင်` (locative, formal) | 17 | 24 |
| `မှာ` (locative, colloquial) | 7 | 6 |
| `များ` (plural, formal) | 34 | 36 |
| `တွေ` (plural, colloquial) | 6 | 4 |

Zero `ရဲ့` in narration across both chapters, with `တွေ`/`မှာ` appearing only in
or near dialogue, is a deliberate and consistently executed register split.
**This is the house style.**

**Connectives are used sparingly and correctly**: `သို့သော်` 5 / 3,
`ပြီးနောက်` 1 / 5, `ထိုအခါ` 2 / 0, `သို့သော်လည်း` 0 / 2.

## 3. Defects in the reference — read as artefacts, not as a repair target

### 3.1 Encoding damage — 15 sites in ch1, 4 in ch2

These came out of the PDF→DOCX conversion. They are recorded so the agent can
recognise the shape and **not** copy it, and so nobody mistakes reference
spelling for truth. The agent does not repair the reference.

Detected by inspection, then confirmed against the dictionary: **the form as
written is not a dictionary word, the repaired form is.** No guessing.

| as written | should be | ch1 | ch2 | proof |
|---|---|---|---|---|
| `အေခြအေန` | `အခြေအနေ` | 2 | 1 | `အခြေအနေ` = NOUN entry; written form absent |
| `အေခြ` | `အခြေ` | 2 | 1 | `အခြေ` = NOUN entry; written form absent |
| `အေတွ့` | `အတွေ့` | 1 | – | `အတွေ့` = NOUN entry; written form absent |
| `အေတွး` | `အတွေး` | – | 1 | `အတွေး` = NOUN entry; written form absent |
| `အေပျာ်` | `အပျော်` | – | 1 | `အပျော်` = NOUN entry; written form absent |
| `အေနြဖင့်` | `အနေဖြင့်` | 1 | – | `အနေ` = NOUN; `ြ` attached to the wrong base |
| `ေချာ` | `ချော` | 2 | – | `ချော` = NOUN entry; written form absent |
| `ဘ၀` (digit `၀`) | `ဘဝ` (letter `ဝ`) | 4 | – | U+1040 in a letter slot |
| `ကြေက်` | `ကြောက်` | 1 | – | vowel `ော` collapsed to `ေ` |
| `မျှာ်` | `မျှော်` | 1 | – | same collapse |
| `လျှက်` | `လျက်` | 1 | – | spurious medial `ှ` |

All are **Zawgyi-order storage or a dropped vowel**, a source-conversion
artifact. The engine cannot repair them; it can only flag them. `lookup_word`
returns a proved repair only where the written form is absent from the
dictionary and a repaired form is present (`အေခြအေန` → `အခြေအနေ`,
`ဘ၀` → `ဘဝ`), which is what makes the class detectable without guessing.

### 3.2 Structural defects

- **Chapter 2's title is empty.** The source has `第二章：仙門逼宮，隨時準備作死！`;
  the DOCX carries only `Chapter 2:`. Chapter 1's title is intact.
- **Trailing spaces on 98% of lines** (171/172 and 189/194). Harmless visually,
  but every one of them becomes a token boundary for the segmentor.
- **2 glued sentences in ch2** (`။` immediately followed by a letter) where the
  rest of the corpus uses a space or newline.
- Page-rule lines (`.....`, `-----`) appear mid-chapter and are page furniture.

### 3.3 Engine-side artefacts that must not be mistaken for text errors

These are *not* defects in the reference and must never be "fixed" by an agent:

| observation | real cause |
|---|---|
| `ဧ`, `ရာဇ်` untagged | absent from `syllable.mapped.txt` |
| `္ဘ`, `္မ`, `္တ` split | Pali units never merged into the lookup |
| `သူ့` untagged | tree root `Y452` exists with an empty tag list |
| `၏` untagged | mapped to `π002`; the tree only carries `π003` |
| `၊ “ ” …` untagged | punctuation, expected |

Total: 11.3% (ch1) / 11.6% (ch2) of tokens come back `{?}`, and roughly
two thirds of that is engine coverage, not writing.

## 4. What this means for the agent

The agent's input is the **AI translation**, and its reference is the
**reference's voice**. The work splits cleanly:

| the agent does | the agent does not |
|---|---|
| judge AI-translated text against the reference's register | touch the reference file |
| restore `၏` / `တွင်` / `များ` where AI drifted to neutral | "modernise" the reference |
| keep terminology consistent across chapters | repair reference encoding damage |
| segment the AI text and read its splits | feed the reference to the segmentor |
| flag meaning errors against the Chinese | diff against a Burmese MT column — none exists |

**Hard rules the measurements justify:**

| rule | evidence |
|---|---|
| narration keeps `၏`, `တွင်`, `များ` | 21/33 `၏`, 0 `ရဲ့` in the reference |
| dialogue keeps `တယ်`, `ပေါ့`, `ပဲ` | 7/11 quoted spans |
| never mix the two inside one sentence | 0 mixed of 155 |
| a rewrite must cite a tool result or a reference count | — |
| `{?}` is not an error signal | 2/3 of `{?}` is engine coverage (3.3) |
| reference spelling is not truth | 19 damaged sites, section 3.1 |

## 5. Reproduce

```bash
python3 mt/quality/profile.py --chapter 1 --chapter 2 --json mt/quality/ch01-02-profile.json
python3 mt/quality/tag.py --chapter 1        # word + tag view
node --import ./scraper/wasm/box/runtime-guard.mjs \
     mt/quality/units.mjs SRC WORK OUT.json  # syllable view, no tagger
```
