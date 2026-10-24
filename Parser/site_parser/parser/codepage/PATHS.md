# Text paths

How a document gets read. There are five ways in, and the order matters:
each is tried in turn and the first that fits wins.

## The paths

| # | Path | How it reads | Status |
|---|------|--------------|--------|
| 1 | **zawgyi** | `ZawgyiDetector` (Markov) decides, `Rabbit.zg2uni` converts | works |
| 2 | **unicode** | the font's own embedded cmap, else its /ToUnicode | works — named in `1064e80` |
| 3 | **wininnwa** | legacy code page `WININNWA_LEGACY_CODE_PAGE`, scored by `scoreText` | untested |
| 4 | **ayar** | legacy code page `AYAR_LEGACY_CODE_PAGE`, scored by `scoreText` | untested |
| 5 | **vector auto-build layout** | builds a code page from the font's own outlines | **not built** |

### On (2), the Unicode path

This used to be invisible. The whole codepage decision sat behind
`if (legacyMap.size)`, and `legacyMap` is only non-empty when the document
carries legacy-layout fonts — so on a plain Unicode PDF no path was ever
*chosen*. The decode happened anyway, through a bare if/else chain further
down that nothing logged and nothing scored. Reading the document as itself
was not a path; it was the absence of one.

It is now a named candidate:

```
text path "unicode": 0.895  <- chosen
[+] Text path: unicode -- the document read as itself, from the
    font's own cmap table (score 0.895). No legacy table applied.
```

### On (5), the fallback

This is the **else branch**. Its job is to catch text-based PDFs that all four
named paths fail on. We do not currently have such a document — every file
available reports `legacyFonts: 0` and reads fine through (2) — but that is a
gap in our samples, not evidence that such PDFs do not exist. So (5) is built
to be the last resort and is expected to be rare.

**It is contour/shape matching, not raster.** It builds a code page by
matching the embedded font's glyph outlines — `outline-vote.mjs`
(`voteByOutline`, `crowdVote`, `buildWitnesses`). `vector-repair.mjs` already
uses this machinery at glyph scale to recover the few ids the decoder cannot
name; (5) is the same idea applied to a whole document.

It is explicitly **not** `vote.mjs` (`renderPdfRegionRgba` →
`matchImageToVector`). That is raster→SVG, and raster→SVG is the OCR repair
stage only. It is not a text path and must not be wired in as one.

### Zawgyi and Unicode are coupled

In `processPageRecord()`:

```js
if (cat === "ZAWGYI" && (pg.decodeKind === "cmap" || pg.decodeKind === "tounicode")) {
  cat = "UNICODE";
}
```

A page decoded through the font's own cmap has its ZAWGYI verdict overridden
to UNICODE. This is correct — a font's own table names Unicode code points by
construction, and a shaped PDF stores ေ and ြ ahead of their consonant, which
is also how Zawgyi stores them, so the detector is fooled. It fires on real
input. But it is a silent veto between two layers and is worth making explicit.

## Scan

`scanText` (`text/scan.mjs`) judges whether text is readable, legitimate
Burmese, by verdict rules: `orphan`, `impossible`, `stray`, `repeat`, `digit`,
`virama`. It currently runs only as a diagnostic, in
`worker/runtime.mjs:writeDiagnosticScan` — always, but only written to disk
when `PRASER_SCAN_LOGGING` is set. It does not influence any path.

**To be placed in: wininnwa, ayar, and the vector path. NOT zawgyi, NOT pure
unicode.** Each path keeps its own existing rule — wininnwa keeps mm-score —
and scan is added beside it, not in place of it.

Whether scan runs per-candidate (before the choice) or once after it is
**undecided**. It cannot be settled by reading the code; it needs numbers from
both arrangements. See "To decide" below.

An empty rule stub is to be left in `repair.mjs` behind the scan call, as a
slot for a repair rule not yet written.

## To decide

1. **Scan timing** — per-candidate or after the choice. Needs a measurement,
   not an argument. The harness at `analysis/vector-medial/path-scan.mjs`
   (not yet written) should decode one document through each path and print
   `scoreText` and every `scanText` rule total side by side.
2. **What "fits" means for (5)** — it is a fallback, so it needs a threshold
   that says the built layout is trustworthy enough to use, rather than
   silently emitting a plausible-looking wrong answer.

## Known gap: there are no fixtures

`Parsed/fixtures/` does not exist. Not in `working`, `architecture`, `dev`,
`site` or `main` of this repo, and not in `scraper`, `pdftotext` or `lingux`.
The files the suite wants are `bg-mlc-1-1.pdf`, `ဘဝထိုထို-part_1.pdf` and
`ocr-marked/zoom-kyone.png`.

Five of the nine test failures are `ENOENT` for these — tests that cannot run,
**not broken code**. Two consequences:

- Paths 3, 4 and 5 have never been exercised. Treating them as working is
  unfounded; treating them as broken is equally unfounded.
- The remaining three failures are real: `analysis/vector-medial/rerank-test.mjs`,
  `backend/cookie/codec.test.js`, and `holds immutable input and measured
  manager/final file information`.
