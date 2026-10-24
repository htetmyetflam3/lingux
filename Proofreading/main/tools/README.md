# `tools/` — ask the files instead of reading them

Three of the sources in this repo are too big to read: the Chinese crawl is
4.1 MB (75,557 lines), the Burmese review is 673 KB, and `master.json` is
1.4 MB. Every question worth asking about them has a short answer, and these
scripts produce that answer in one screen.

**The rule: if a question is about *which* chapter, *what* it is called, or
*what is missing*, run a command here — do not open the file.** Opening the file
costs the whole thing, and it gets re-sent on every later turn of a session.

| tool | answers | cost |
|---|---|---|
| `audit_source.py` | parsed chapter starts, unrecognized numbers (not proof of absence), and duplicate boundaries | 1 s, one screen |
| `chapter_titles.py` | chapter titles in both languages, from the DOCX | 1 s, one screen |
| `mcp.py` | every MCP tool as one safe CLI flag; the same server the clients launch | local unless translated |
| `mcp_server.py` | the MCP library/server; no CLI entry | launched only by `mcp.py --serve` |
| `agent_english.py` | aligned Chinese / local MT English / API English and bounded prior Burmese keyword context | local, read-only |
| `../vps.py` | one-shot file upload/download to the VPS | one ssh |

## `mcp.py` — one flag, one tool, one run

Run from the repository root. With no command it prints help and does nothing.
Each of the 18 MCP tool names has a matching underscore flag, plus a readable
spelling (`--translate_text` and `--translate` are the same command). `--serve`
is only for an MCP client.

```sh
uv run mcp.py --help
uv run mcp.py --read_chapter 194 --start 1 --count 10
uv run mcp.py --compare_english_chapter 194 --start 1 --count 10
uv run mcp.py --previous_burmese_context "နတ်" --chapter 194
uv run mcp.py --segment --file paragraph.txt
uv run mcp.py --getTitle 193
uv run mcp.py --insecpt --check-range 194-408
uv run mcp.py --selftest
```

`--inspect`/`--insecpt` and `--getTitle` delegate to the source audit and DOCX
title tools below; they do not load either full source into an agent. The server
uses the same `Server.call_tool()` as direct CLI invocations.

## `audit_source.py` — what the crawl really has

The crawl is a web scrape, and it shows: titles get glued onto the end of a body
line, running page headers get promoted to chapter starts, and an OCR glitch can
turn a chapter heading into another number. The audit reports numbers it cannot
recognize as standalone starts; that is a parser result, not proof that the
chapter is absent. In particular, the author says 241, 298 and 299 have titles
mid-body. The OCR-aware parser now recovers 241; 298 and 299 remain unrecognized
starts. `--check` is a conservative gate that requires manual resolution—not a
verdict that those chapters are missing.

```sh
python3 tools/audit_source.py                      # summary
python3 tools/audit_source.py --check 194-408      # is this range safe?
python3 tools/audit_source.py --titles --from 194  # title table
python3 tools/audit_source.py --json               # for a script
```

Current parser result for this checkout:

```
435 heading candidates from 75,557 lines; last number 408
376 on '=====' lines; 59 glued into body text
33 glued headings are the only recognized start; 14 repeat an open chapter
not recognized as chapter starts: [298, 299] (not proof of absence)
```

Chapter 241 is recovered from its OCR-damaged mid-body `第二自四十一卓`
header; the local MT parser joins its repeated page fragments. Chapters 298 and
299 remain parser gaps. Do not declare either absent or invent their contents.

`--check` exits **1** when the parser cannot recognize every chapter start in the range. This is a conservative batch gate, not proof of source absence:

```sh
python3 tools/audit_source.py --check 194-408 && echo safe to run
```

## `chapter_titles.py` — the two-language title table

Reads only the `[ZH]`/`[MY]` heading paragraphs of the merged DOCX, so it never
touches body text.

```sh
python3 tools/chapter_titles.py                     # all 193, numbered
python3 tools/chapter_titles.py --at 194 --at 195   # just these
python3 tools/chapter_titles.py --from 190 --to 193
python3 tools/chapter_titles.py --summary           # counts and gaps
python3 tools/chapter_titles.py --write content/merged/titles.json
```

The DOCX is the **human-translated span only** — Chinese 1–193 ↔ Burmese 1–195.
Ask for 194 and it prints a blank title, because there is no title to print. For
194+ the crawl is the only witness, so use `audit_source.py --titles`.

## `../vps.py` — the file mover

Already complete; unchanged. Both directions run from the local box, never on
the VPS.

```sh
uv run vps.py --upload   ./.env              scraper/
uv run vps.py --download '~/scraper/.env'    ./
```

## Why these exist

Each one replaces a manual step that had already gone wrong at least once:

- `audit_source.py` ← the three missing chapters were discovered by grepping a
  4 MB file three separate times, and chapter 61's stub body was nearly sent to
  the API.
- `chapter_titles.py` ← the title of a chapter past 193 had been guessed from
  the review, which is a document about tone, not a table of contents.
