# Recovering the dropped medials — `အကီး` → `အကြီး`

## Result

The medials were never missing from the file. They were being **dropped**:
the subset leaves a few glyphs unnamed, `/ToUnicode` carries whitespace as
filler, and the decoder honestly emits nothing at all.

```
BEFORE :  ...အင်ေမာ်တယ်အကီးအကဲချုပ်...      အကြီးအကဲ = 0
AFTER  :  ...အင်ေမာ်ယ်အကြီးအကဲချုပ်...      အကြီးအကဲ = 89
```

Book-wide, measured with the project's own segmentor over 682,951 syllables:

| | failing syllables | rate |
|---|---|---|
| before | 1,382 | **0.201%** |
| after  | 359   | **0.053%** |

## The three defects

### 1. The vote ranked by popularity, not shape

`crowdVote` sorted `b.votes - a.votes || a.best - b.best`. At the medial's
glyph the corpus scored byte 66 `္ဘ` at distance 0.0486 with 4 votes, and
byte 125 `ြ` at **0.0422** with 2. The closer, correct shape lost on votes.
Now `a.best - b.best || b.votes - a.votes`.

Raising `CLAIM_LIMIT` could never have fixed this — the candidate was
already inside the limit and lost on the ordering rule.

### 2. The glyphs were unnamed, so the decoder emitted nothing

`FontDecoder._docLookup` reached `return ""` for the ids 239 / 241 / 247 —
0.9% of glyphs, and exactly the medials. New `codepage/vector-repair.mjs`
reads the outline out of the embedded subset, votes it against the 339-face
corpus, and decodes the answer. It is consulted **only where the decoder
produced the empty string**, so the 99.1% that worked cannot regress.

One trap: a merged PDF carries unrelated families whose glyph ids are not
comparable. Here gid 241 is ြ in the eleven upm=900 Myanmar3 subsets and ဆ
in the two upm=2048 subsets, and the wrong answer fitted better (0.0293 vs
0.0476). Voting is therefore restricted to the primary font's family, chosen
by the `pickEmbeddedFont` the pipeline already trusts.

### 3. A medial behind a consonant that never takes one

WinInnwa writes medials before their consonant, so the recovered ြ arrived
as `အြကီး`. `movePrebaseMarks` left it there because အ looked like a home.
Which consonant may host which medial is now read off the inventory rather
than asserted — `MEDIAL_HOSTS` in `text/cleanup.mjs`, derived from the
2525 MonoSyllabism reference syllables and the 2482 in
`burmese-inventory.json`, which agree cell for cell:

```
ျ 26 consonants    ြ 15    ွ 25    ှ 11
```

အ appears in none of the four; လ is absent from ြ.

## Measuring it

`node analysis/vector-medial/segment-check.mjs .debug/mono <file.txt>...`

Segments with `MonoSyllabism`'s own `runSegmentor` and scores against both
inventories. Two things it must do to mean anything:

- **Round-trip the inventory through the segmentor's own mapper.** The
  segmentor normalises → maps to ASCII → walks → maps back, and that round
  trip does not return its input byte for byte. Comparing its output against
  raw inventory strings scores a difference in *representation* as a defect
  in the *text*, which is what made `နှင့်` look broken when it was fine.
- **Tally bare marks and page digits apart.** A lone း, ် or ၁ is a token
  the segmentor could not attach to anything, not a failed syllable.

Consonant+် tokens (င် ဇ် က် န် …) are likewise not syllables — the inventory
has no such entry, which is the point — so they are reported beside the
figure, not inside it.

## Notes

`crowdVote` had zero importers before this; it is now reached through
vector-repair. `PRASER_VECTOR_REPAIR=0` turns the repair off.

Parser tests: 42 pass / 6 fail, byte-identical to the pre-change baseline
(verified by stashing). Unit tests 17/17.
