# Machine translation (`mt/`)

> Setup, keys, Kilo, the MCP server and every command flag live in
> [`SETUP.md`](SETUP.md). This file only explains the two translation routes.

Two routes, one runner. Engine availability is checked before anything runs.
The tracked one-file mode records only the translation text; engine and coverage
summary are printed to stdout. Legacy multi-file mode writes a report.

```
zh-en   Chinese -> English   offline model installed          RUNS HERE
en-zh   English -> Chinese   offline model                    RUNS HERE
```

There is no local machine-translation route to or from Burmese. The current
tracked API output is English-only (`content/mtranslate/english.txt`); generated
API Burmese text has been removed, and the separate Burmese rewrite workflow is
suspended unless the human explicitly re-enables it. The human Burmese reference
remains available as context but has known encoding damage, so it is not an
authoritative spelling or grammar baseline. These two Argos routes provide
Chinese → English reading and an English → Chinese reverse check.

## Install

```sh
python3 mt/fetch_engine.py --install zh-en   # clones and unpacks the model
python3 mt/fetch_engine.py --check           # what is installed; writes nothing
python3 mt/fetch_engine.py --remove zh-en
```

Models go to `$XDG_DATA_HOME/argos-translate/packages` and are not committed.
Installing needs no packages: the `.argosmodel` is a zip and it is unpacked
in-tree. Only running a model needs `ctranslate2` and `sentencepiece`, in the
same `python3` that runs `mt/translate.py` (see `SETUP.md` 1.1).

## Run

The tracked local MT outputs are exactly one file per direction:

```sh
uv run mt/translate.py --list
uv run mt/translate.py --route zh-en --one-file --chapters 1-408
uv run mt/translate.py --route en-zh --one-file --chapters 1-408
```

These write `content/mtranslate/zh-en.txt` and `content/mtranslate/en-zh.txt`;
the reverse route reads `zh-en.txt` by default. One-file mode is resumable and
creates no chapter files, reports, manifests, or database sidecars. It prints
coverage to stdout. Chapter 241 is reconstructed from its OCR-damaged mid-body
page headings; 298 and 299 remain unrecognized starts. Do not claim those two
are absent or invent their contents—the run reports the parser gap.

The older per-chapter/report mode remains available only for explicit legacy
runs. The merged human source under `content/merged/` is preserved separately.

## What the two routes are for

| route | what it is for |
|---|---|
| `zh-en` | read the Chinese source in English; a fallible machine-translation witness |
| `en-zh` | reverse-check the local English reading by translating it back into Chinese |

Neither produces Burmese or replaces the Chinese source. The human Burmese in
`content/source/ယဲ့နင်.txt` and `content/merged/episodes.docx` is retained for
historical context, but known encoding damage makes its wording uncertain. Verify
interpretations against Chinese; do not treat the human text as spelling or
grammar truth.

## Reading the Chinese

The local MT parser splits the source at recognized chapter headings and
converts Chinese numerals to chapter numbers. It also handles the specific
OCR-damaged mid-body header used for chapter 241 and joins its repeated page
fragments. Chapters 298 and 299 remain parser gaps, not claims of source absence.

## What the offline model actually produces

Sample, first sentences from the local zh-en route (`content/mtranslate/zh-en.txt`):

```
These people, they're the bottom of the week.
If we go to Wei, isn't it the power of the Emperor?
That's why Tsai was almost unsuspecting and stopped the displaced first.
```

`底子` becomes "bottom of the week" and `蔡向高` becomes "Tsai" — useful for
gist, not for publishing. The offline Argos models are local aids, not an
accuracy authority; check meaning against Chinese.

## Legacy API translator (Chinese → Burmese; human-run only)

This optional legacy tool is outside the current tracked workflow. API-generated
Burmese outputs have been removed; do not call it or recreate those files unless
the human explicitly re-enables that separate task.

`mt/rapidapi_translator.py` speaks the RapidAPI "Multi format AI translator" API
and `mt/api_translate.py` runs it over chapters of the local source, writing
JSONL/TXT plus a Chinese/Burmese comparison against the existing human
translation. `mcp.py` exposes the same calls as a local MCP server.

```sh
python3 mt/api_translate.py --chapters 1-2 --plan   # offline, no key
RAPIDAPI_KEY=... python3 mt/api_translate.py --chapters 1-2 --run
```

The key is read from `RAPIDAPI_KEY`, or from a file named with `--env-file`
(nothing is loaded implicitly; `.env` is gitignored), never stored. `mt/chapter_map.py` reads the
Chinese↔Burmese chapter numbers out of `content/merged/episodes.docx` (last
existing: Chinese 193 ↔ Burmese 195; next untranslated: 194), and `--chapters
last|next|existing` uses it for both the run and the comparison reference.
`mcp.py --selftest` checks the MCP server without a key or network, and
`mcp.py --print-config --client kilo|claude|codex|gemini` prints that
client's config. See `mt/RAPIDAPI.md` for the endpoint formats, the SSH/phone
setup, and the cache/retry rules.
