# mcp.py CLI regrouping — design and agent execution flow

Status: **PROPOSAL, awaiting approval. No code has been changed.**
Date: 2026-10-26. Scope: `Proofreading/main/tools/mcp.py` (the CLI door) only.
`mcp_server.py` and its 18 tool schemas are out of scope.

---

## 1. Why regroup

Today `mcp.py` advertises six argparse groups (server, reading, writing, paid,
admin, options, config, inspect) and one "options" drawer holding ~35 modifier
flags with no indication of which command each one belongs to. The agent notes
in this directory (`START.md`, `arena-english-review-entry.md`,
`ch01-02-report.md`, the three `linga-*.md` probes) describe a workflow that is
strictly phased — preflight, source gate, study, terminology, bounded window
loop, evidence, saves — but the flat flag list hides that phasing. An agent
reading `--help` cannot tell which flags are safe on the review track (all
local) versus which spend money, or which modifiers a command actually accepts.

The regrouping makes the help surface mirror the real workflow, using one
declarative table as the single source for help, validation and dispatch.

## 2. Ordered-value convention (applies to every flag below)

Each flag is documented as an ordered value spec:

- **Value 1 — mandatory.** The flag itself and, where it takes one, its
  positional argument. A run is invalid without it.
- **Value 2 — optional, first tier.** The command's direct modifiers — the
  ones used in the normal workflow.
- **Value 3 — optional, second tier.** Advanced or rare modifiers, tuning and
  machine-facing output.

Sketch shape: `flag / its direct modifiers / advanced modifiers`. Omitting
value 2 or 3 never changes the meaning of value 1; defaults are unchanged from
the current parser.

## 3. The categories and per-flag value specs

### 3.1 Control plane — lifecycle of the door itself

Exception, stated honestly: these six entries are mutually exclusive lifecycle
commands, not one action with modifiers, so there is no true "mandatory". They
are rendered in the same three-tier visual shape as commands / common checks /
settings.

| tier | flag | purpose |
|---|---|---|
| 1 commands | `--serve` | speak MCP on stdio; launched by a client, never by hand |
| 1 commands | `--print-config` | print a client config snippet and exit |
| 1 commands | `--install-config` | merge the entry into a client's JSON config |
| 2 checks | `--selftest` | init + tools/list + ping in-process, no key, no network |
| 2 checks | `--check` | whether the key is set and where config lives; no request |
| 2 checks | `--list-tools` (alias `--list-groups`) | every advertised tool, schema size, groups, presets |
| 3 settings | `--client {json,claude,kilo,codex,gemini}` `--config PATH` `--env-file PATH` `--tools SPEC` | which client and which tool subset |
| 3 settings | `--existing PATH` `--cache PATH` `--no-cache` `--docx PATH` `--source-file PATH` `--draft-store PATH` | server resource paths |

### 3.2 Source gate — prove the source before any chapter work

- **`--inspect`** (alias `--insecpt`, kept)
  - value 1 (mandatory): none — the flag alone runs the crawl audit
  - value 2: `--check-range LOW-HIGH` (exit 1 when a range has holes)
  - value 3: `--titles` (title table instead of summary)
- **`--get-title [CHAPTER]`** (alias `--getTitle`, kept)
  - value 1 (mandatory): chapter number, positional
  - value 2: `--from N` `--to N` (a span of titles)
  - value 3: `--summary` (counts and gaps), `--write PATH` (save table JSON)

### 3.3 Chapter read — local, no key, no request

- **`--read [CHAPTER]`** (alias `--read_chapter`, kept)
  - value 1 (mandatory): chapter number, positional
  - value 2: `--start N` `--count N` (the bounded paragraph window)
  - value 3: `--chapter N` (chapter without a positional), `--json`

### 3.4 English review — the active track (all local)

- **`--compare-english [CHAPTER]`** (alias `--compare_english_chapter`, kept)
  - value 1 (mandatory): chapter number, positional
  - value 2: `--start N` `--count N` (defaults to ten paragraphs)
  - value 3: `--api-file PATH` / `--api-dir PATH`, `--machine-file PATH` /
    `--machine-dir PATH` (alternate aligned inputs)
- **`--previous-burmese-context [BURMESE_KEYWORD]`** (alias
  `--previous_burmese_context`, kept) — companion command, still a full server
  tool
  - value 1 (mandatory): Burmese keyword, positional
  - value 2: `--chapter N` (**required** by this tool; missing it exits 2)
  - value 3: `--before-lines N` `--after-lines N` `--max-hits N`

### 3.5 Review digest — study the 111-section review without opening the file

- **`--review-brief`** (alias `--review_brief`, kept)
  - value 1 (mandatory): none — the flag alone prints the digest
  - value 2: `--chars-per-arc N` (60 keeps it near 4–6k tokens vs 8–13k)
  - value 3: `--json`
- **`--review-lookup [QUERY]`** (alias `--review_lookup`, kept) — companion
  command
  - value 1 (mandatory): query text, positional
  - value 2: `--chapter N` (required), `--section N_OR_TITLE`
  - value 3: `--query TEXT` (query without a positional), `--limit N`

### 3.6 Terminology — names and dictionary authority

- **`--check-names [TEXT]`** (alias `--check_names`, kept)
  - value 1 (mandatory): text to scan, positional
  - value 2: `--chapter N` (scan source text instead of an argument)
  - value 3: `--json`
- **`--lookup-name [TERM]`** (alias `--lookup_name`, kept) — companion command
  - value 1 (mandatory): term, positional
  - value 2: `--term TERM` (without a positional)
- **`--lookup-word [WORD]`** (alias `--lookup_word`, kept) — companion command
  - value 1 (mandatory): word, positional
  - value 2: `--term TERM`
- **`--register-name`** (alias `--register_name`, kept) — the only mutating
  entry here
  - value 1 (mandatory): none; validity needs `--key ENGLISH` + `--burmese MYANMAR`
  - value 2: `--key` `--burmese`
  - value 3: `--note TEXT`

### 3.7 Segmentation

- **`--segment [TEXT]`** (alias `--segment_text`, kept)
  - value 1 (mandatory): Burmese text, positional
  - value 2: `--text TEXT` (text without a positional) or `--file PATH`
  - value 3: `--json`

### 3.8 Drafts — the suspended rewrite track (local writes)

- **`--save-draft`** (alias `--save_draft`, kept)
  - value 1 (mandatory): none; validity needs `--chapter N` + `--paragraph INDEX_OR_ID` + `--draft TEXT`
  - value 2: `--chapter` `--paragraph` `--draft`
  - value 3: `--ai-text TEXT` `--model NAME` `--note TEXT`
- **`--export-drafts [CHAPTER]`** (alias `--export_drafts`, kept) — companion
  command
  - value 1 (mandatory): chapter number, positional
  - value 2: `--out-dir PATH`
  - value 3: `--require-all` (fail if any paragraph lacks a draft)

### 3.9 Verse — poems, songs, maxims (local writes)

- **`--save-verse`** (alias `--save_verse`, kept)
  - value 1 (mandatory): none; validity needs `--chapter N` + `--kind KIND` + `--english TEXT`
  - value 2: `--chapter` `--kind` `--english`
  - value 3: `--english-source TEXT` `--mt-english TEXT` `--paragraph INDEX_OR_ID` `--note TEXT`
- **`--export-verse [CHAPTER]`** (alias `--export_verse`, kept) — companion
  command
  - value 1 (mandatory): chapter number, positional
  - value 2: `--out-dir PATH`
  - value 3: `--require-all`

### 3.10 Paid translation — RapidAPI quota, human-authorized track only

Every flag in this category makes a network request and is **forbidden inside
the English-review track**.

- **`--translate [TEXT]`** (alias `--translate_text`, kept)
  - value 1 (mandatory): source string, positional
  - value 2: `--target LANG` `--source LANG`
  - value 3: `--max-chars N` `--timeout SECONDS` `--attempts N`
- **`--detect [TEXT]`** (alias `--detect_language`, kept) — companion command,
  one API request
  - value 1 (mandatory): string, positional
- **`--translate-batch`** (alias `--translate_batch`, kept) — companion command
  - value 1 (mandatory): none; input comes from `--file PATH` (one string per line)
  - value 2: `--file` `--target` `--source`
  - value 3: `--max-items N` `--max-chars N` `--timeout` `--attempts`
- **`--translate-chapters [SPEC]`** (alias `--translate_chapters`, kept)
  - value 1 (mandatory): spec — `194+195`, `194&195`, `194`, or omitted for the next pair; two chapters max
  - value 2: `--target` `--source`
  - value 3: the same four tuning flags

### 3.11 Cross-cutting flags

`--json` stays global (machine-readable output where a printer supports it) but
help lists it under each group that honors it, instead of in the junk drawer.
No flag is removed; every name in the current parser appears in exactly one
category above.

## 4. Full coverage check (nothing dropped)

18 server-tool doors: read, segment, review-brief, review-lookup, lookup-word,
lookup-name, check-names, save-draft, export-drafts, register-name, save-verse,
export-verse, detect, translate, translate-batch, translate-chapters,
compare-english, previous-burmese-context — all present in §3.
Six door commands: serve, selftest, check, print-config, install-config,
list-tools — §3.1. Two script-backed commands: inspect, get-title — §3.2.
All ~35 modifiers from the current "options"/"config"/"inspect" groups are
assigned to a value 2 or value 3 tier above. A Phase A unit test will assert
this exhaustively against the live parser.

## 5. Agent practical usage — the end-to-end execution flow

Grounded in `START.md` and `arena-english-review-entry.md` (two-phase task with
a hard checkpoint, no API calls, trial chapters 194–195) and the window
discipline recorded in `ch01-02-report.md`.

**Phase 0 — Preflight (control plane).** Before touching content:
`uv run mcp.py --selftest --json` must return ok=true with exactly 18 tools;
`uv run mcp.py --check` confirms key/config state. Failure here stops the task.

**Phase 1 — Source gate.** Never assume a chapter exists:
`uv run mcp.py --inspect --check-range 194-408` (exit 1 on holes; 298/299 are
the known unrecognized starts, not missing chapters) and
`uv run mcp.py --get-title 194` to confirm title alignment. A failed gate is
reported, not worked around.

**Phase 2 — Study, bounded only.** Read the task docs in this directory, then
`--review-brief --chars-per-arc 60` and targeted `--review-lookup ... --chapter N`.
Whole-file reads are forbidden; the 4.1 MB crawl, 673 KB review and 1.4 MB
master.json are only ever reached through these commands. This phase ends at
the documented checkpoint STOP — no comparison work begins until authorized.

**Phase 3 — Load terminology authority before prose.** `--lookup-name`,
`--lookup-word`, `--check-names` settle every name and term before the first
judgment, so later windows apply one consistent glossary.

**Phase 4 — The bounded window loop.** At most ten paragraphs per call:
`uv run mcp.py --compare-english 194 --start 1 --count 10`, then follow the
returned `next_start` cursor until the chapter boundary; use
`--read 194 --start 1 --count 10` for the Chinese control and
`--previous-burmese-context "နတ်" --chapter 194` for term precedent in the two
prior chapters. The Burmese human reference is encoding-damaged clue material;
Chinese controls meaning. No call may grow beyond its window to "save turns".

**Phase 5 — Evidence-only judgments.** Every finding cites the tool result and
paragraph index it came from. Engine defects versus text defects are kept in
separate columns, as in `ch01-02-report.md`; unrecoverable `{?}` tokens are
dictionary coverage, not text errors.

**Phase 6 — Provenance-tracked saves (currently suspended).** When the track
is re-opened: `--save-draft` with chapter/paragraph/draft, `--export-drafts N`
at chapter end, `--save-verse` / `--export-verse` for verse, `--register-name`
only for an approved new term. Exports wait for explicit authorization.

**Phase 7 — Paid track is a separate human-run lane.** `--translate`,
`--detect`, `--translate-batch`, `--translate-chapters` never run inside
Phases 1–6. They are invoked only on explicit human instruction, with tuning
(`--max-chars`, `--max-items`, `--timeout`, `--attempts`) decided per job.

## 6. Build execution plan

- **Phase A — table, no behavior change.** Add a declarative `CLI_GROUPS`
  structure holding category → tiers → flags. Add a test asserting every flag
  the current parser defines appears exactly once and all 18 server tools map
  to a category. Parser output and dispatch untouched.
- **Phase B — help rebuild.** `build_parser()` renders the categories with
  labeled mandatory / value-2 / value-3 subsections. Every flag name,
  underscore alias, and the `--insecpt` / `--getTitle` typo aliases remain
  identical. `test_mcp_cli.py` must pass unmodified; the rendered `--help` is
  shown for review before continuing.
- **Phase C — table-driven validation.** Replace the ad-hoc mutually-exclusive
  checks with validation generated from the table, preserving exact exit codes
  and message strings (§7).
- **Phase D — standalone tools join the same shape.** The unwired scripts in
  `format/` (8) and `mt/` (13) plus `init/main.py` become new categories using
  the same three-tier spec, wired in-process after the `_run_inspect`
  precedent. The table grows; the pattern does not change.

`_arguments()` dispatch and the whole of `mcp_server.py` stay untouched. The
server's own `TOOL_GROUPS` (read, english, review, names, verse, draft, api)
and six presets (survey, edit, lean, translate, english-review, full) remain
authoritative for `--tools` and are not renamed — `test_tool_groups.py` pins
them. CLI category names harmonize where they overlap but never override.

## 7. Contract that must stay green

From `.bin/python/mt-tests/test_mcp_cli.py` and `test_tool_groups.py`:

- no flags → help, exit 0, stdout contains "Pick one command" and
  "--translate_text"; no jsonrpc noise
- `--selftest --json` → ok=true, exactly 18 tools
- every server tool still has its exact `--tool_name` underscore flag
- `--read_chapter 194 --count 1` alias path works (chapter 194, one paragraph)
- `--getTitle 193` prints 葉大人來了
- `--insecpt --check-range 194-408` exits 1 and mentions 298, 299, not 241
- context command without `--chapter` exits 2 with "needs --chapter"
- conflicting commands exit 2 with "one command per run"
- unknown flag exits 2 with usage
- kilo `--print-config` payload: command[1] is the mcp.py path, command[2] is `--serve`
- schema-token rationale unchanged: 18 schemas ≈ 12.9k chars per request
  against an 8k-token/min free budget, which is why presets exist

## 8. Open decisions for review

1. Category names in §3 are proposals; rename freely before Phase A.
2. Whether `--json` should gain a one-line mention in every group's help or
   stay listed once under a global heading.
3. Phase D ordering: which standalone CLI family enters the door first
   (suggested: `format/repair_damage` + `repair_quotes`, since repair work
   already appears in the review findings).
