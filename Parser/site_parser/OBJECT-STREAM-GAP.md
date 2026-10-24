# PRIORITY FOR THE NEXT AGENT: PDF object streams are not handled

Read this first. It is the one known hole in the PDF parser that nobody has
closed, and it is not a corner case.

## The gap

The JavaScript PDF parser in this repository does **not** understand object
streams (`/ObjStm`) or cross-reference streams (`/XRef` streams, PDF 1.5+).

Verified, not assumed:

```
grep -rn "ObjStm" --include=*.mjs --include=*.js Parsed/ backend/
  -> 0 matches
```

A PDF that stores its objects inside a compressed object stream will have those
objects invisible to `parsePdfObjects()`. The page tree may not resolve, fonts
may not be found, and the result is empty text or `[XXXX]` placeholders — with
no error that names the real cause.

## Where the fix already exists

**The Python PDF parser in the `scraper` repository has this solved.**
Repository: `htetmyetflam3/scraper` — look under `python/bin/` and
`crawler/bin/` (`pdf_support.py`).

That is the reference implementation. Port it, or port its approach, into the
JS parser here.

**I could not verify this myself.** `raw.githubusercontent.com` is not
reachable from the sandbox this was written in (only `github.com`,
`api.github.com`, `codeload.github.com` are), and the API fetch of that file
returned nothing. So the statement "the scraper Python parser handles object
streams" is the repository owner's, recorded here on their authority. **Confirm
it before you start porting** — it should take one read of that file.

## What does NOT cover it

- the JS parser on the `site` branch — no
- the JS parser on the `working` branch — no
- the Python parser on the `working` branch — no

All three lack it. This is not a case of one branch lagging behind another.

## Why it was not fixed here

The document this whole session was measured against
(`ယဲ့နင် စာစဉ် a ၁.merged.merged.pdf`, 4,414 pages) contains **zero** `/ObjStm`.
It was checked. Object streams were therefore not the blocker for that file,
and building support for them would not have improved its output.

That is a statement about one document. It says nothing about the next one.

## Suggested test

Before porting, get a PDF that actually uses object streams — most files
written by a modern producer (PDF 1.5+, linearised, or saved from a recent
word processor) will. Confirm the current parser fails on it, then confirm the
ported code fixes it. Without a failing case you cannot tell a working port
from a silent no-op.

## Related

`Parsed/parser/codepage/PATHS.md` describes how the text paths are chosen, and
records which of them have ever actually been exercised.
