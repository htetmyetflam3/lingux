# Bridge/Parser — parser entry APIs (drafts)

Boundary entries through which the **scraper** and the **Site backend** call
the document parser. Both inline parser copies were removed in the lingux
reorg; the parser's future home is `Parser_host/`. Drafts pin the exact entry
contracts already in use so wiring later means implementing against
Parser_host without changing caller shapes.

## Scraper routine (Python + Node worker)

| File | Replaces (deleted) | Entry protocol |
|---|---|---|
| `pdf-classify.draft.py` | `Scraper/main/modules/result/pdf_classify.py` + `Scraper/praser/`, `Scraper/map/`, `Scraper/model/` | in-process: `classify_pdf(bytes) -> ClassifyResult`, `extract_convertable_text(bytes) -> (text, decode, pages)`, `get_detector()` |
| `ocr-worker.draft.mjs` | `Scraper/deploy/continuous-ocr/worker.mjs` + `Scraper/ocr_runtime/Praser/parser/` | persistent stdio worker: stdin one JSON `{input, output}`/`{close}` per line, stdout `OCR_RESULT {json}` lines, ready banner at boot |

Scraper callers left dangling: `modules/download/save_local.py`,
`modules/result/text_collect.py`, `deploy/continuous-ocr/run.py`,
`deploy/continuous-parse/run.py`, `ocr.py`, `parse.py`.

## Site routine (node ESM)

| File | Replaces (deleted) | Entry protocol |
|---|---|---|
| `site-parser-manager.draft.mjs` | `Site/Backend/file/praser.js`, `file/parser.js`, `file/pdfanalysis.js` (backed on linga `site` by `Parsed/parser/manager.mjs`, never copied into lingux) | Manager worker pool: `new Manager({outputDir})`, `dispatch({job, method, output, inPath, filename, inputKind, outPath, data?}) -> {file, text?, imageFiles?}`, `close()`; plus injected factory shape `{parse(filePath, out, {intent}), bindIdentity()}` and the txt/pdf/docx upload router |
| `site-parser-writer.draft.mjs` | `Site/Backend/gateway/queue/analysisFinalize.js` + `Parsed/parser/index.mjs` writers | `writeDocxPlain(path, text)`, `writePdf(path, lines, meta, sourceName, version)`, `RESULT_MIME`, `acceptsAnalysisResultExtension(...)`, `finalizeAnalysisArtifact(...)` |

Site callers left dangling: `Site/index.js` (`closePraserManager`),
`Backend/gateway/api/incoming.js` (all four factories + `createParser`),
`Backend/gateway/api/curl.js` (pdf/docx factories),
`Backend/gateway/api/engineCollect.js` (finalize trio),
`Backend/gateway/engineRoundtrip.test.js`.

The Site's decision routine is **not** a draft — it is pure ESM with no
parser dependency and moved verbatim to
`Bridge/parser-routine/site/manager-handoff.mjs` (`managerPayload(intent) ->
{job, method, output}`).

## Shared notes

- `Site/Backend/file/paths.js` stays (db/frontend constants are shared), but
  its parser exports (`PARSED_ROOT`, `PRASER_MANAGER`, runtime dirs,
  `validatePraserAssets`, fixture/getter constants) now dangle and must
  retarget to Parser_host; `Site/index.js` calls `validatePraserAssets()` at
  boot, so wiring is required before the server can start.
- Verdict contract for both routines: `Bridge/parser-routine/README.md`
  (scanned→OCR / old→preserve / convertable→convert; DOCX extension pending
  on the scraper side).
- Drafts throw `NotImplementedError` / `[draft]` errors by design; none are
  imported by live code yet.
