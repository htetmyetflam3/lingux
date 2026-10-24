# The praser, mapped

Not a description of the code — the code is authoritative. This is the part you
cannot get by reading one file: **which layer a thing belongs to, and which
words mean two different things.**

The rule is what the layer dirs are for: a thing belongs to the lowest layer that
can own it, and an upward import is a bug in the placement, not in the rule.

---

## 1. The spine that has never changed

The Python praser named thirteen jobs in `prase.py`'s own docstring. Every one of
them is still here, under the same name, doing the same job. **Nothing in this
restructure renamed, merged, split or re-scoped a spine module.** They only got
an address.

| job | Python | here |
| --- | --- | --- |
| path resolution | `paths.py` | `core/paths.mjs` |
| low-level PDF / cmap / layout parsing | `pdf_extract.py` | `read/pdf-extract.mjs` |
| per-`/Font`-resource decoders | `pdf_fonts.py` | `read/pdf-fonts.mjs` |
| DOCX reading | `docx_extract.py` | `read/docx-extract.mjs` |
| Zawgyi/Unicode detection | `detector.py` | `text/detector.mjs` |
| Zawgyi → Unicode | `rabbit.py` | `text/rabbit.mjs` |
| imposter cleanup + mark reorder | `cleanup.py` | `text/cleanup.mjs` |
| Burmese quality score | `mm_score.py` | `text/mm-score.mjs` |
| diagnostic scan | `scan.py` | `text/scan.mjs` |
| font profiles / roles | `fonts.py` | `write/fonts.mjs` |
| writers | `render.py` | `write/render.mjs` |
| shared service layer | `pipeline.py` | `pipeline.mjs` |
| entry | `prase.py` + `cli.py` | `prase.mjs` |

Everything else in this tree is JS-era growth: OCR, shape matching, code-page
voting, workers, zip/ttf/qpdf, limits, manager. That growth is why the folders
exist — it arrived faster than anywhere to put it.

---

## 2. The three words that mean different things

This is the single biggest source of "I cannot map this".

### "layout" meant three unrelated things

| what was called *layout* | what it actually is | now called |
| --- | --- | --- |
| `LEGACY_CODE_PAGES`, "legacy layout", the voted table | a map **byte code → Myanmar text** for one legacy font | **code page** — `codepage/` |
| `lines`, `wh`, char boxes from the PDF | where ink sits on the page | **geometry** (stays in `read/`) |
| `layoutPara`, `writeDocxLayout`, `wantLayout` | paragraph placement in the **output** document | **layout** — kept, `write/` only |

From here on, **"layout" only ever means output document layout.** The byte→letter
table is a *code page*, and it has one owner.

### "vector" / "SVG" / "pixels" — the two sides of one measurement

There is no either/or. The repair compares **a vector reference against the page
as drawn**, and the three files in `shape/` are literally the three sides of it:

```
shape/svg.mjs      REFERENCE   labelled specimen sheet   -> contours   (vector, map/vector/*.svg)
shape/raster.mjs   PAGE        the rendered pixels         -> contours   (bitmap)
shape/match.mjs    COMPARE     contours or mask            -> a label    (distance field, nearest match)
```

The reference side is SVG because a traced outline keeps sub-glyph topology that
a bitmap throws away. The page side is the **raw pixels PDF.js painted**, read
out of the page canvas where the matcher needs them: no image file format is
produced in between, because encoding and decoding inside one process only
removes information the previous step already had exactly.

The one place an image file is written is the OCR lane, where tesseract is given
a page as a file — and that file is PNG. A lossy encode around a 0.6 pt mark is
what the recogniser then has to see through, so it is not offered one.

**SVG is the answer key, the page's own pixels are the exam paper.**

### "praser" / "parser"

`Parsed/parser/` is the directory; `prase.mjs` is the entry; `PRASER_*` are the
backend's constants. All three spellings are deliberate and load-bearing. Do not
"fix" them.

---

## 3. The layers

Low to high. **A file may import its own layer, or anything to its left.** Never
right.

```
core  →  read  →  shape  →  text  →  codepage  →  write  →  pipeline / prase
```

| layer | owns | may import |
| --- | --- | --- |
| `core/` | paths, limits, pylib shims, zip, qpdf, TTF cmap, **the log contract** | nothing outside `core/` |
| `read/` | container → text + geometry: PDF, DOCX, OCR, page render | core |
| `shape/` | pure glyph geometry: svg / raster / match | core |
| `text/` | bytes → correct Unicode: detect, rabbit, cleanup, normalize, score, repair, scan | core |
| `codepage/` | which byte means which letter, for legacy fonts | core, read, shape, text |
| `write/` | text → `.txt` / `.docx` / `.pdf` | core |
| `pipeline.mjs` | **assembly only** — wires stages, owns no logic | everything below |
| `prase.mjs` | entry: CLI + `praseFile()` | everything below |
| `manager.mjs` | worker supervision for the site | everything below |

Beside the stack, not above it:

| | |
| --- | --- |
| `worker/` | thread entry points. **Shells only** — every one is under 90 lines and contains no decision |
| `tools/` | one-off probes and generators. May read anything; nothing reads them |
| `test/` | same |
| `map/`, `model/` | data assets, no code |

Two exceptions exist and both are written down in the guard test:

1. **`(root) → worker`** — `manager.mjs` starts the worker threads it owns. That
   is spawning, not layering.
2. **Data has no layer.** A module that imports *nothing* is data, and anyone may
   read it. Exactly two qualify: `codepage/registry.mjs` and `codepage/names.mjs`.
   This is what lets `read/pdf-fonts.mjs` ask "is this a legacy font name?"
   without inverting the stack.

### Worked example of the rule doing its job

`write/ttf.mjs` used to import `parseTtfCmap` from `read/pdf-extract.mjs` — the
writer reaching into the extractor, the only backwards edge in the whole graph.
The fix was not an exception. Reading a TrueType `cmap` table is something *both*
sides need, so it belongs below both: it is now `core/ttf-cmap.mjs`. Same logic,
lower address. `core/zip.mjs` and `core/qpdf.mjs` moved for the same reason.

---

## 4. The confusing region, resolved

This was the part that could not be held in one head. It is one subsystem with
**one door**.

```
                    a legacy PDF arrives
                             │
         ┌───────────────────▼────────────────────┐
         │        codepage/resolve.mjs            │   ← the ONLY entry
         │  the front door. nothing outside       │
         │  codepage/ calls the three below.      │
         └───────┬────────────────────────┬───────┘
                 │                        │
   prepareVectorLayout()           chooseCodePage()
   GATE + BUILD                    SCORE + PICK
                 │                        │
                 ▼                        ▼
   cheap PDF-structure check     every registered table
   ── no legacy font? stop.      (+ the voted candidate)
      zero pixels rendered.      decodes the first pages;
                 │               the Burmese score decides.
                 ▼               <50 marks scores 0, so a
        codepage/vote.mjs        lucky short match cannot win
        build a table from                   │
        the pixels drawn                     ▼
                 │                  one table, chosen, scored
      only for byte codes where
      registered tables DISAGREE
                 │
                 ▼
        shape/  (svg | raster | match)
                 │
                 ▼
     codepage/registry.mjs   known tables (data)
     codepage/names.mjs      known legacy font names (data, generated)
```

The two things worth remembering:

- **The gate is the point.** An ordinary Unicode or Zawgyi document never loads a
  specimen sheet and never renders a pixel. All that machinery costs nothing
  unless a legacy font is actually present.
- **A vote is a candidate, not a verdict.** `vote.mjs` hands back a table;
  `resolve.mjs` scores it beside the registered ones against the same quality
  floor. A weak auto-build cannot win by being new.

Both halves were inline in `pipeline.mjs`. Assembly should not also be deciding —
that is why they moved.

---

## 5. Logging

Stages take a `log` parameter and default it to a no-op. They emit; they never
decide where text goes. That shape is unchanged.

What is new is **one owner for what a sink is**: `core/log.mjs`.

```js
import { SILENT, collect, stdoutLog, tee, resolveLog } from "./core/log.mjs";

const log = collect();          // log.lines is the array, live
await praseFile(input, out, { log });
```

| | |
| --- | --- |
| `SILENT` | discard. the default for every stage parameter |
| `stdoutLog()` | one line per message. what the CLI uses |
| `collect()` | push into `sink.lines`. what every test and tool was hand-rolling |
| `tee(a, b)` | fan out |
| `resolveLog(opts)` | the `{ logging, log }` rule, previously inline in `prase.mjs` |
| `PREFIX` | `[+]` ok · `[-]` warn · `[i]` info · indent for per-item detail |

The prefixes are named so a structured logger can key off them later instead of
regexing `"[+] "` back out of a string.

---

## 6. Where to start reading

| question | file |
| --- | --- |
| what happens to an uploaded file, end to end | `prase.mjs` → `praseFile()` |
| how the stages are wired | `pipeline.mjs` (assembly only) |
| what the site is allowed to call | `index.mjs` |
| why a legacy PDF decoded the way it did | `codepage/resolve.mjs` |
| is it SVG or pixels | `shape/` — both, §2 |
| where does a path come from | `core/paths.mjs`, and nowhere else |
| what a log sink is | `core/log.mjs` |
