# Scraper plugin — Parser bridge

`parse-bridge.mjs` is the integration plugin that connects the scraper to the
Parser engine. It replaces the Python classification ladder in
`main/crawler/bin/pdf_classify.py`, which depended on a bundled `praser/`
Python port that no longer exists. The decision itself is not reimplemented
here — it lives in the Parser (`Parser/main/parser/caller-policy.mjs`), the
single owner of scraper policy. This file is only the process/IO adapter.

## Policy (owned by the Parser Manager, not here)

For the `scraper` caller the Manager allows exactly three outcomes:

| Verdict        | When                                                        | Scraper action            |
| -------------- | ----------------------------------------------------------- | ------------------------- |
| `convertable`  | Unicode or ZawCode text layer decodes cleanly               | text written to `.txt`    |
| `scanned`      | extraction yields no readable text (image-only document)    | PDF preserved as-is       |
| `old`          | legacy/old-font layout (`wininnwa`/`ayar`/vector) — skipped | PDF preserved as-is       |

`old` is a normal terminal verdict, not an error: the Manager returns
`{ skipped: true }` from a cheap pre-parse gate, so no worker decode runs.

## Usage

```
node parse-bridge.mjs --out RESULT.json [--ocr] PDF [PDF ...]
```

- `--out RESULT.json` (required) — the JSON verdict array is written here.
  Results never go to stdout: the Parser logs through `console.log`, including
  from worker threads, so stdout/stderr stay diagnostic (the same contract as
  `crawler/bin/segment_bridge.mjs`).
- `--ocr` — route a scanned document through the Manager's OCR lane instead of
  reporting `scanned`. Off by default; a missing tesseract model degrades back
  to a `scanned` verdict rather than failing.
- one Node process handles the whole batch; the Manager is created once.

### Exit codes

- `0` every input reached a terminal verdict (`old`/`scanned` included)
- `2` bad usage
- `1` the Parser front door could not be loaded at all

A single document failing never aborts the batch — it becomes an
`{ "category": "error" }` verdict so the crawler can continue.

## Verdict object

```json
{
  "input": "abs/or/relative/path.pdf",
  "filename": "path.pdf",
  "category": "convertable | scanned | old | error",
  "encoding": "unicode | zawgyi-one | null",
  "encodingPath": "unicode | zawcode | vector:<Font> | ...",
  "reason": "unicode | legacy-font-not-convertible | no-text-layer | ...",
  "pages": 100,
  "textChars": 80538,
  "textBytes": 225376,
  "lineCount": 1993,
  "outputFile": "/…/.output/<uuid>.txt",
  "counts": { "ZAWGYI": 100, "UNICODE": 0, "UNKNOWN": 0 },
  "ms": 486
}
```

## Calling from Python

Mirror the existing `_find_node22()` + `subprocess.run` transport in
`main/crawler/bin/text_collect.py` (the one that already runs
`segment_bridge.mjs`):

```python
proc = subprocess.run(
    [node, str(PLUGIN), "--out", result_json, *pdf_paths],
    stdout=subprocess.DEVNULL,          # diagnostics only
    stderr=subprocess.PIPE,
    env=env,
    timeout=3600,
)
if proc.returncode == 0:
    verdicts = json.loads(Path(result_json).read_text("utf-8"))
```

## Requirements

- Node.js 22+ (the same preflight the rest of the scraper enforces).
- The Parser's own dependencies installed under `Parser/main/parser`
  (`pdfjs-dist`, `@napi-rs/canvas`, `mammoth`, …). This plugin has no
  dependencies of its own; the Manager loads them lazily and resolves them
  from the Parser folder.
