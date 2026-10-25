# parser-routine — shared input decision group

The decision every Burmese document passes through before any work runs:

- **scanned** → image-only, goes to OCR
- **old** → pre-standard / undecodable font, PDF preserved as-is
- **convertable** → Unicode or Zawgyi-One text layer, goes to conversion

## Why two dirs — consumer boundary, NOT a language boundary

The whole lingux project is JS and Python side by side, and most runtimes are
mixed. The only hard language rule is: **the browser frontend cannot run
Python**. Everything else can use either language.

| Dir | Consumer | Runtimes allowed | Notes |
|---|---|---|---|
| `site/` | Site product: frontend probe + backend routing | JS in the frontend (hard); backend may be node **or Python** | the browser-safe probe is the canonical JS implementation |
| `scraper/` | crawler saving logic (`save_local`, `text_collect`, continuous services) | Python-first, but **may run the frontend JS through Node** | mixed runtime already in production here |

Files land per consumer in whichever language the runtime needs — do not
create `js/` vs `python/` splits. A routine dir can contain `.py`, `.mjs`,
`.js` side by side.

### The crawler already runs frontend-style JS (established pattern)

`Scraper/crawler/bin/text_collect.py` is Python, but its segmentation step is
a Node subprocess: `_find_node22()` scans nvm/fnm/volta/system paths, prepends
that bin dir to `PATH`, and runs
`subprocess.run([node, "segment_bridge.mjs", out_path])`. The OCR service
(`deploy/continuous-ocr/run.py`) spawns `worker.mjs` the same way. Reusing the
Site probe JS from the scraper routine follows this exact bridge — no new
interpreter, no port — when the JS implementation is the one to trust. The
Python `pdf_classify.py` stays for the deep server-side decode ladder
(identity → embedded cmap → ToUnicode + sidecar cipher), which Python owns.

### Design rule for shared JS

Any JS meant to run in both the browser and under the crawler's Node
subprocess must stay **isomorphic**: browser globals only (`TextEncoder`,
`Uint8Array`, dynamic `import("pdfjs-dist/…")`), no `node:` builtins, no
`process.env`, no filesystem access in the probe itself. Node-only wrappers
(argument parsing, file IO, stdout JSON) live in a separate thin entry that
imports the isomorphic core.

Python dependencies are owned by the root `pyproject.toml`; JS dependencies by
the root `package.json`. No nested project config inside this group.

## The contract

### Inputs

- **PDF** — implemented on both sides today.
- **DOCX** — required extension. The Site probe already classifies DOCX
  (`docx-text` / `docx-images`); the scraper routine is PDF-only today and must
  gain the same DOCX input decision (via the JS probe under Node or a Python
  equivalent using the same constants) before the group is complete.

### PDF verdicts (same criteria both sides)

1. **scanned** — image-dominant or no usable text layer
   (`imageBytes > textBytes * 20` AND `textBytes/page < 120`, or sampled
   non-whitespace text < 24 chars). Route: OCR.
2. **old** — text exists but is not genuinely readable Burmese. Three
   structural gates on the decoded/converted text, model-independent:
   - decoded sample contains no Myanmar pair (`[\u1000-\u109F]{2}` absent),
   - coverage floor: average Myanmar chars/page < 12,
   - structural scan rate > 0.01 (orphan marks, impossible pairs, stray
     marks, bare virama per Myanmar char).
   Route: preserve original, no conversion.
3. **convertable** — passes all gates. The Zawgyi/Unicode detector's only job
   is splitting genuine Myanmar text between the two encodings; it never
   decides old vs convertable. Route: convert + normalize.

### DOCX verdicts

- `docx-text` — text-bearing, images not dominant.
- `docx-images` — `imageBytes > 0 && imageBytes > textBytes * 3` (manual/image
  handling; images re-embedded for docx/pdf output).

### Threshold constants (single source of truth — keep every implementation in step)

| Constant | Value | Used for |
|---|---|---|
| `PDF_TEXT_MIN_CHARS` | 24 | whole-doc text-based floor (non-ws chars) |
| `PAGE_TEXT_MIN_CHARS` | 12 | per-page text-page floor; also old-doc coverage floor |
| `PDF_IMAGE_DOMINANCE` | 20 | imageBytes multiplier |
| `PDF_TEXT_BYTES_PER_PAGE` | 120 | image-dominance per-page bound |
| `PDF_INSPECTION_MAX_PAGES` | 32 | spread-sampled inspection depth |
| `DOCX_IMAGE_DOMINANCE` | 3 | docx image-heavy multiplier |
| `OLD_FONT_SCAN_RATE` | 0.01 | old-vs-convertable structural ceiling |
| `MAX_TEXT_CHARS` | 20,000,000 | extraction budget |

## Where the code lives today (landing sources; nothing moved yet)

### Site routine → `site/`

- `Site/Frontend/frontend-bootstrap/js/detect.js` and the React twin
  `Site/Frontend/frontend-react/src/lib/detect.ts` — isomorphic byte-level
  image scan, pdf.js/mammoth sampling probe (`detectPdf`, `detectDocx`,
  `pdfImageBytes`); candidate canonical core for crawler reuse
- `Site/Frontend/frontend-bootstrap/js/upload.js` — verdict mapping
  (`pdf-text` / `pdf-images` / `pdf-scan` / `docx-text` / `docx-images` /
  `unsupported`) and `route()` → job/method sent to the backend
- Backend routing that consumes the same facts (node today; Python allowed):
  `Site/Backend/gateway/queue/managerHandoff.js` (`managerPayload`),
  `Site/Backend/file/praser.js` (Manager dispatch),
  `Site/Backend/file/pdfanalysis.js`

### Scraper routine → `scraper/`

- `Scraper/crawler/bin/pdf_classify.py` — `classify_pdf(bytes)` returning
  `scanned | old | convertable` (its header explicitly states it is the
  scraper-side port of the Site's two inspection layers, same thresholds);
  also `extract_convertable_text` for the no-verdict convertable queue
- Supporting `Scraper/praser/` package: `detector.py` (Zawgyi/Unicode model,
  encoding split only), `scan.py` (structural rules), `pdf_extract.py`,
  `pdf_fonts.py` (cmap/ToUnicode decoding ladder), `rabbit.py`, `cleanup.py`,
  `mm_score.py`, `paths.py`
- JS bridge entries already in the crawler: `crawler/bin/segment_bridge.mjs`,
  `deploy/continuous-ocr/worker.mjs`, `scripts/check-node.mjs`
- Consumers: `Scraper/crawler/bin/save_local.py` and
  `Scraper/crawler/bin/text_collect.py` (save/routing decisions), plus the
  `deploy/continuous-ocr` and `deploy/continuous-parse` services

## Known asymmetry to preserve on purpose

- Site frontend probe: browser-bound, sampled (max 32 spread pages), routing
  only — never converts.
- Scraper classifier: server-side full decode ladder, full-document
  extraction and conversion inside the convertable verdict.
- Same thresholds and verdict meanings; different depth by design.
