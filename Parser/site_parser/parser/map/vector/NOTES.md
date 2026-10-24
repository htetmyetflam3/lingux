# The vector map: keys, the 17 MB file, and what is already measured

For whoever is about to change this layer. Everything below was measured in this
repo, on `bg-mlc-1-1.pdf` and the 339-face witness file — not assumed.

## The key is the byte, on purpose

The unknown is **which letter** a glyph slot carries. A legacy PDF gives you a
byte in a font program and the shape that byte draws; whether it means `က` or
`ထ` is the whole question. Key the reference side by *letter* and the lookup
needs the answer before it can run — you would be matching `က` with `က`. The
byte is the only axis both sides already share, and
[`../../codepage/registry.mjs`](../../codepage/registry.mjs) is the thing that
turns a byte into a letter. Unlabelled witness data is not missing
metadata: labels would be the conclusion, and a file that carried them would
make the vote unnecessary.

## What the 17 MB file is for

`font-witnesses.json` = **crowd testimony**: every legacy face reduced to the
shape it draws at each byte of the code page. Coordinates only, no letters, no
font outlines. Runtime never opens a TTF — `gen-font-witnesses.mjs` paid that
(14 s boot scan) once, offline, and shipped the answer. Regenerating it:

```
node scrmgr.js exe restore-legacy-fonts.mjs   # 334 faces -> Parsed/fonts/legacy (gitignored)
node scrmgr.js exe gen-font-witnesses.mjs      # -> this file, ~16 MB
```

Both live in `scripts.db`, category `build`. Nothing in the parser depends on
them; only the data does.

**Hand-edited data files carry rules, not correspondence.** `shape-overrides.json`
is read by `gen-shape-thresholds.mjs` and never written by it, so anything in it
that is not a field the generator reads is a note to a person. Notes of that
kind get acted on and deleted -- a `measured` block that said "for you to rule
on / pending your call" is gone, and deleting it reproduced
`shape-thresholds.json` byte-identically apart from `generatedAt`, which is the
proof it was never read. If a measurement needs to survive, it belongs in this
file or in the generator's own comment; the JSON holds the decision.

## The alias veto, and why a majority is not evidence

`shape-alias.json` lists the letter pairs the crowd itself cannot place, and
[`../../shape/match.mjs`](../../shape/match.mjs) refuses any accepted shape
whose runner-up is one of them. If three faces say "at this byte I draw what the
reference calls `က`" and one says "at this byte I draw `ထ`, and it looks like
your `က`", the fourth is not an outlier to be outvoted: it is proof that a real
typeface exists where the two are indistinguishable to a single-reference
matcher — which is all the matcher has. So the pair is vetoed, the slot is left
unclaimed, and the disagreement stays visible instead of becoming a letter
nobody can defend. Rebuild it with `node scrmgr.js exe gen-shape-alias.mjs`
(2 s, no rendering): 339 faces, 83 disputed bytes, 508 testimonies, 23 vetoed
pairs today — `ဗ/ဘ` 4:2, `ဆ/သ` 8:3, `ဓ/ိ` 19:19.

## Measured and rejected — do not re-derive these

| idea | why it fails |
| --- | --- |
| key by letter, store only the ~40 labels that differ across fonts | **318 of 334** legacy faces carry no Myanmar-block `cmap` entry at all: they cannot say what letter they draw. The 16 that can agree with the Pyidaungsu sheet on **7.3 %** of their `(face, label)` pairs — the "everything else is shared" premise is inverted |
| pack the witnesses finer so slots become decidable | 8 / 16 / 24 / 32 points → 16.3 / 30.7 / 45.1 / 59.6 MB; same-byte vs different-byte separation **0.0023 / 0.0022 / 0.0024 / 0.0022**. Quadrupling the file moves the gap by 0.0001 |
| identify the embedded face, then use its own shapes | best `0.14665`, margin **0.00000–0.0019**, and the winner was `U4SHT007.TTF` for a document whose `/BaseFont` says WinInnwa. Same name, different drawing: `EAAAAA+WinInnwa` vs the repo's `WININNWA.TTF` = mean **0.12353** over 131 shared bytes, **0** exact (the subsetter also renumbers: `glyphId(0x41)` is 65 there, 3 here) |
| name a letter by nearest shape against the sheet | over all 2,598 labels: top-1 **0.0 %**, truth-in-top-5 1.4 %. Face drift is smaller than letter distance |
| pre-generate a labelled sheet per font (`gen-vector-sheet.mjs --font X --layout wininnwa`) | supplies the layout to the reference side to get labels the fonts cannot give — the same circularity, with more files |
| vote the plurality | that is what the veto replaced, above |
| rasterise to compare shapes for a digital PDF | rasterising is the OCR lane's job. A digital page has outlines and GIDs; the sheets are svg-to-svg at one scale factor (A4 at 72 dpi) |

## Who reads what

| file | read by | status |
| --- | --- | --- |
| `PYIDAUNGSU-*.svg` | `shape/match.mjs` | live — the naming authority |
| `shape-thresholds.json` | `shape/match.mjs` (`bars()`) | live — per-letter margin bars |
| `shape-alias.json` | `shape/match.mjs` (`aliasTable()`) | live — the veto above |
| `font-witnesses.json` | `gen-shape-alias.mjs` offline; `codepage/outline-vote.mjs` | live offline; **the outline island has no runtime caller yet** |
| `shape-safety.json` | nothing | `gen-shape-safety.mjs` writes per-letter topology bands for `topologyMatches`, whose only callers are in that same island. Not dead — unwired, and it is inert until the island is |
| `shape-overrides.json` | `gen-shape-thresholds.mjs` (rows below) | **wired through the generator**: `groups` set the strict bars, `distinct` + `atomic` select the lenient factor, `strictness`/`leniency`/`baseline` are the three factors. The bars it writes are what `bars()` reads per crop, so these judgements do reach runtime -- one step upstream of the matcher, never inside it |

---

## Where everything lives (checked, not assumed)

The whole shape-matching layer is in this repo. Nothing it needs sits in an
untracked directory. Read this before assuming something has to be fetched.

### Runtime data — tracked, in `Parsed/parser/map/vector/`

| File | What it is |
|------|------------|
| `font-witnesses.json` | the crowd testimony: every legacy face reduced to the shape it draws at each byte. Coordinates only, no letters |
| `shape-alias.json` | shapes treated as the same letter |
| `shape-overrides.json` | hand-edited. Read by `gen-shape-thresholds.mjs`, never written by it |
| `shape-thresholds.json` | generated. Distance cutoffs per shape |
| `PYIDAUNGSU-2.5.2_REGULAR-sheet-{1,2}.svg` | the specimen sheets |
| `NOTES.md` | this file |

Runtime never opens a TTF. It only reads `font-witnesses.json`.

### Generator scripts — tracked, inside `scripts.db`

`scrmgr.js` (tracked, repo root) runs scripts out of the SQLite database
`scripts.db` (**tracked**, ~2.9 MB). The `scripts` table holds 60 entries.
The ones this layer needs, all category `build`:

```
node scrmgr.js exe restore-legacy-fonts.mjs   # 334 TTFs -> Parsed/fonts/legacy
node scrmgr.js exe gen-font-witnesses.mjs     # -> font-witnesses.json
node scrmgr.js exe gen-shape-alias.mjs
node scrmgr.js exe gen-shape-thresholds.mjs
node scrmgr.js exe gen-shape-safety.mjs
node scrmgr.js exe build-legacy-font-names.mjs
```

`restore-legacy-fonts.mjs` must run first; the witness generator cannot build
the file without the faces.

### The font binaries — recoverable from this repo's own history

`Parsed/fonts/legacy/` is gitignored on purpose, but the faces are not lost
and no external archive is needed. They are in this repository's history:

- `9ac97f8` (#30) and `bd2f63e` (#31) added **535** font files
- `9eb3b97` (#35 — a commit about worker threads, whose subject never
  mentions fonts) deleted **374** of them

`restore-legacy-fonts.mjs` recovers 334 TTFs with a `git archive`. Class:
`recover-able` — no network, no zip, no external archive.

Separately, **109** Unicode faces are tracked directly under `Parsed/fonts/`.

### What is NOT here

`Parsed/parser/tools/vector-evaluation/` — the evaluation harness from the
`scraper` release asset (`linga-vector-evaluation-recovery.zip`). It is not in
the repo (0 tracked files) and the runtime shape matching does not need it. It
is offline evaluation tooling only.
