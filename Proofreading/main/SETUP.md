# Setup and command reference

One document for a VPS over SSH. Terminal only: every step is copy-paste, no GUI.
Order: dependencies → keys → models → Kilo → MCP → the run → every flag.

Paths assume the clone is at `~/proofreading`. If it is elsewhere, adjust `$REPO`.

```sh
export REPO="$HOME/proofreading"
cd "$REPO"
git pull
```

---

# Part 1 — Setup

## 1.1 Python and dependencies

**One interpreter runs everything in `mt/`: `python3`.** Third-party packages go
into that same interpreter, and every command in this document is spelled
`python3 …` for exactly that reason.

```sh
python3 --version                                  # 3.10 or newer
python3 -m pip install --break-system-packages \
    ctranslate2 sentencepiece                      # only for --engine offline
python3 -c "import ctranslate2, sentencepiece; print('ok')"
```

Only `mt/translate.py --engine offline` imports those two, and only when it
loads a model. Installing a model (`mt/fetch_engine.py`) is standard library: it
unpacks the `.argosmodel` zip itself and never imports `argostranslate`.
Everything else — `mt/apicaller.py`, `mt/api_translate.py`, `mcp.py`,
`mt/lexicon.py`, `mt/overview_index.py`, `mt/agent_work.py` — needs nothing
installed at all.

### Why not `uv run`

The `pyproject.toml` at the repo root is the **scraper's** environment
(selenium, pikepdf, pyarrow), not `mt/`. `uv run mt/…` builds or reuses that
environment, so it can install hundreds of megabytes to run a script that needs
none of it — and it is a different interpreter from the one
`pip --break-system-packages` just installed `ctranslate2` into. That is the
drift: a model installed for `python3`, then a runner started by `uv` that
cannot see it.

If you have uv and want it, keep it out of the project for the stdlib scripts:

```sh
uv run --no-project mt/apicaller.py --status       # optional spelling
```

Never use `uv run` for `mt/translate.py --engine offline` unless you installed
`ctranslate2` and `sentencepiece` inside that same environment.

Node is only needed by the engine under `Engine/` (segmentation and POS), which
`mt/lexicon.py` shells out to:

```sh
node --version
cd "$REPO/Engine" && npm install --omit=dev && cd "$REPO"
```

## 1.2 Keys in `~/.env`

One file, two keys, both outside the repository. It is in `.gitignore`.

```sh
cat > ~/.env <<'EOF'
RAPIDAPI_KEY=your_rapidapi_key
GROQ_API_KEY=gsk_your_groq_key
EOF
chmod 600 ~/.env
```

Who reads what:

| key | read by | for |
|---|---|---|
| `RAPIDAPI_KEY` | optional `mt/api_translate.py` API runs | external API translation; current tracked output is English-only and Burmese API text has been removed |
| `GROQ_API_KEY` | the agent host (Kilo), exported into its shell | the model that runs the proofreading agent |

The repository never reads `GROQ_API_KEY`. A variable named `groq` or `GROK_API_KEY`
will not be found: the name is exactly `GROQ_API_KEY`.

Verify without leaking the value:

```sh
set -a; . ~/.env; set +a
echo "RAPIDAPI_KEY: ${RAPIDAPI_KEY:+set}"
echo "GROQ_API_KEY: ${GROQ_API_KEY:+set}"

curl -s https://api.groq.com/openai/v1/models \
  -H "Authorization: Bearer $GROQ_API_KEY" | head -c 200
```

Two `set` lines and a model list mean the keys are good. `401` = wrong value,
`403` = key lacks access.

## 1.3 Offline translation models (optional)

Only needed for `mt/translate.py`. The two Argos routes are local Chinese ↔ English;
there is no Burmese machine-translation route. The human Burmese source is a
separate, encoding-damaged reference. API-generated Burmese text is not retained
in the current workflow.

```sh
python3 mt/fetch_engine.py --check
python3 mt/fetch_engine.py --install zh-en
python3 mt/fetch_engine.py --install en-zh
python3 mt/translate.py --list          # the two routes, now available
```

Exactly two routes exist, the two `mt/translate.py` runs: `zh-en` and `en-zh`.
Models land in `$XDG_DATA_HOME/argos-translate/packages` (`translate-zh_en-1_0`,
~86 MB each) and are never committed. `--check` writes nothing, anywhere;
`--json` prints the same table as one object. The model fetch is standard library;
the translation runtime dependencies are declared in the PEP 723 script metadata.

To produce the consolidated outputs (no chapter files, reports, or manifests):

```sh
uv run mt/translate.py --route zh-en --one-file --chapters 1-408
uv run mt/translate.py --route en-zh --one-file --chapters 1-408
```

These write `content/mtranslate/zh-en.txt` and `content/mtranslate/en-zh.txt`.
The second route reads the first file by default. Each is resumable and writes
only its one `.txt` output; the command prints parser coverage to stdout. Confirm
`missing_chapter_numbers` is empty before treating the range as complete.

## 1.4 Dictionaries (optional, for the chapter merge)

```sh
python3 format/fetch_dicts.py --check
python3 format/fetch_dicts.py
```

CC-CEDICT (~8.6 MB) + English–Myanmar (~16.7 MB), sha256-verified, rebuildable.
Not needed by the proofreading agent.

## 1.5 Kilo

Skip this block if `kilo --version` already answers; only the config below matters
then.

```sh
npm install -g @kilocode/cli         # or: curl -fsSL https://kilo.ai/install | sh
kilo --version
```

Config file: `~/.config/kilo/kilo.jsonc` (global). Project file: `./kilo.jsonc`.

```sh
mkdir -p ~/.config/kilo
cat > ~/.config/kilo/kilo.jsonc <<EOF
{
  "\$schema": "https://app.kilo.ai/config.json",
  "model": "groq/openai/gpt-oss-120b",
  "provider": {
    "groq": {
      "options": { "apiKey": "{env:GROQ_API_KEY}" },
      "models": {
        "openai/gpt-oss-120b": {
          "name": "gpt-oss-120b",
          "tool_call": true,
          "limit": { "context": 131072, "output": 1024 }
        }
      }
    }
  },
  "mcp": {
    "rapidapi-translator": {
      "type": "local",
      "command": [
        "$(command -v python3)",
        "$REPO/mcp.py", "--serve",
        "--env-file", "$HOME/.env"
      ],
      "enabled": true
    }
  }
}
EOF
```

Why `output` is 1,024: Groq charges the **declared** `max_tokens` against the
per-minute budget, whether or not the model uses it. Work the arithmetic per
turn — the tail of a `review_brief` test already carries ~6.1k of prompt, so
`2048` puts that request at 8.1k and it is rejected (413 "Limit 8000, Requested
8271") before a token is generated, while `1024` leaves ~900 tokens of headroom.
There is no way to "grow into" the budget: a reservation that overflows fails.

On a plan with a real ceiling the same reasoning sets 16,000 rather than 32,000:
this model narrates its reasoning, so a 32k reservation is 32k of narration per
turn that you pay for and never read, and Kilo subtracts the reservation from
the context before it compacts.

Which plan is this key on? The response headers say so:

```sh
set -a; . ~/.env; set +a
curl -s -D - -o /dev/null https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"openai/gpt-oss-120b","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}' \
  | grep -i 'x-ratelimit-limit-tokens'
```

`8000` is free, `250000` is Developer.

Three things that bite:

- `{env:GROQ_API_KEY}` is expanded by Kilo, not the shell. The variable must be
  **exported** into the process that starts Kilo: `set -a; . ~/.env; set +a`.
- `--env-file` keeps `RAPIDAPI_KEY` out of the config file. Nothing secret is
  written to `kilo.jsonc`.
- The model string is `provider/model`. Kilo has a built-in `groq` provider, so
  no base URL is needed.
- The `models` block above is not decoration. Kilo's built-in Groq catalog is
  stale — after Groq's 2026 retirements it may list **only**
  `meta-llama/llama-prompt-guard-2-22m` and `-86m`, which are input-security
  classifiers, not chat models: a 512-token window, and the output is one 0–1
  jailbreak score rather than text — they cannot follow an instruction or call a
  tool. (The limits Kilo prints beside them are requests and tokens per minute or
  day, not context; Groq's own page says 512 in, 512 out.) Declaring
  `openai/gpt-oss-120b` here is what makes
  `groq/openai/gpt-oss-120b` resolvable at run time, even when `kilo models groq`
  still does not print it.

**Check the config took, before running anything.** A bad key or an unknown model
id makes Kilo fall back to Auto Free silently, so `/status` is the only proof:

```sh
set -a; . ~/.env; set +a
kilo models groq                          # your account's list; the id must appear
kilo                                      # then, inside the TUI:
#   /models   -> pick groq/openai/gpt-oss-120b
#   /mcps     -> rapidapi-translator: on
#   /status   -> the active model is the groq one, not Auto Free
```

If `openai/gpt-oss-120b` is not in `kilo models groq`, the `models` block above
registers it by hand — that is what `provider.groq.models` is for.

Model choice, for Burmese specifically:

| model | note |
|---|---|
| `groq/openai/gpt-oss-120b` | 131,072 context, 65,536 max completion, reasoning model. Verbose by design — it narrates its thinking — which costs tokens but costs nothing in a `kilo run` session nobody reads. Default here because the context window fits a whole chapter plus the tool output |
| `groq/moonshotai/kimi-k2-instruct` | strongest multilingual on Groq, 128K; shorter reasoning, more direct |
| `groq/llama-3.3-70b-versatile` | cheap and fast, weak Burmese; fine for structure |

To quiet the reasoning, Groq accepts `reasoning_effort` of `low`, `medium` or
`high`; pass it as a provider option if your build forwards it, or leave it —
the chatter goes to the transcript, not to the draft.

Every one of them is weak at Burmese relative to this task. The tools are what
make output checkable; the model only makes it readable.

## 1.6 MCP server

```sh
uv run mcp.py --selftest        # protocol round-trip, no network
uv run mcp.py --check           # config state, no request
uv run mcp.py --serve --env-file ~/.env # run it (stdio; Kilo does this for you)

# the same, advertising only the tools a reading pass needs (see `--tools`)
uv run mcp.py --serve --env-file ~/.env --tools survey
```

Register it with a client automatically instead of by hand:

```sh
uv run mcp.py --print-config --client kilo
uv run mcp.py --install-config --client kilo --env-file ~/.env
```

`--install-config` merges into plain JSON only. If the target is JSONC with
comments it refuses and prints the snippet, so nothing you wrote is lost.

Eighteen tools. Reading and checking (free, no API request):
`read_chapter`, `compare_english_chapter`, `previous_burmese_context`,
`review_lookup`, `review_brief`, `lookup_word`, `lookup_name`, `check_names`,
`segment_text`, `detect_language`. Writing, all local:
`save_draft`, `export_drafts`, `register_name`, `save_verse`, `export_verse`.
Paid, never on your behalf: `translate_text`, `translate_batch`,
`translate_chapters`.

All eighteen are advertised by default, and their schemas — 12,886 characters,
about 3.2–4.3k tokens — are re-sent with **every** request. `--tools survey`
(11 tools, 7,501 characters) covers the Burmese reading pass, `--tools lean`
(7 tools, 5,468) covers a drafting pass, and `--tools english-review` (7 tools,
5,448) adds the English comparison, previous-Burmese context, review and names.
Details in *`mcp.py`* under Part 3.

Two things there are deliberately **not** tools: finding new names, and finding
verse. Both are reading judgements the agent makes while it reads the AI text
for tone; a scanner would produce candidates with no sense of which matter, and
a verse regex cannot tell a couplet from a short sentence. The tools only write
down what the agent decided.

---

# Part 2 — The run

## 2.1 Produce the AI translation (the only paid step)

Two chapters per call, never the whole novel at once. The first call is 194 +
195: the human translation ends at Chinese 193 (`episodes.docx`), and these are
the first two chapters behind it.

```sh
cd "$REPO"
python3 mt/apicaller.py --status                   # cursor, chapters left; free
python3 mt/apicaller.py                            # plan 194 + 195; free
python3 mt/apicaller.py --run --env-file ~/.env    # translate 194 + 195
python3 mt/apicaller.py --run --env-file ~/.env    # 196 + 197
```

The cursor moves by itself: a chapter that already has a JSONL under
`content/mtranslate/rapidapi/` is not offered again.

`&` is a shell operator — unquoted, `--194&195` backgrounds `--194` and tries to
run `195`. Quote it, or use `+`:

```sh
python3 mt/apicaller.py '--194&195' --run --env-file ~/.env
python3 mt/apicaller.py --194+195 --run --env-file ~/.env    # same pair
```

194 + 195 is 363 paragraphs, 6,427 characters, **10 requests** (40 paragraphs
per request). A third chapter is refused *by this caller*, and the refusal
prints the pairs to run in order. `mt/api_translate.py` — the batch engine under
it — takes any range; see *2.1b* for the one-file English run.

Writes `content/mtranslate/rapidapi/`:

```
ch0194.my.jsonl            one record per paragraph: source, target, cached
ch0194.my.txt               the chapter in Burmese
pair-0194-0195.my.txt       both chapters
compare-ch194-ch195.md      Chinese | new Burmese | existing human Burmese
report-0194-0195.json       this pair's report
report.json                 the latest report, overwritten each run
```

Re-running is free for anything already cached; the cache is
`content/mtranslate/rapidapi-cache.sqlite3`. `--json` prints the plan or the
report as one object, which is what the agent reads.

## 2.1b The whole tail in English, one `.txt`

When the goal is English for the agent to read rather than a Burmese draft to
publish, skip the pair machinery: `api_translate.py` takes the range, and
`--one-file` makes it write **one text file and nothing else** — no SQLite
cache, no jsonl, no per-chapter txt, no comparison, no report.

```sh
cd "$REPO"
python3 mt/api_translate.py --chapters 194-408 --one-file --target en          # plan
python3 mt/api_translate.py --chapters 194-408 --one-file --target en --run --env-file ~/.env
```

* The last chapter number in this source is **408**, not 421. The local MT
  parser reconstructs `241` from OCR-damaged mid-body page headers and joins its
  page fragments. The legacy API selector does not use that join; its `241`
  result needs separate review. Chapters `298` and `299` are not recognized as
  standalone starts. These are parser coverage notes, not proof that source text
  is absent. Do not invent text for unrecognized chapters or claim they do not
  exist.
* `--one-file` alone writes `content/mtranslate/english.txt`; give a path to put
  it elsewhere. `--target` defaults to `en` in this mode.
* **Resume by pasting the same command again.** The chapter headings are the
  cursor: a chapter already in the file is skipped, and a chapter cut off
  mid-write is rewritten rather than left as a stump. Nothing else tracks state,
  which is why there is no database to lose.
* `--pause` (default `0.5`) is the gap between chapters. Use the current
  offline plan for its request estimate; 429s are retried with backoff, and a
  rerun costs only the chapters that are not in the file yet.
* `--plan` prints the counts and how many chapters the file already holds; it
  never creates the file.

The heading is what a later pass reads, so leave it alone:

```
===== Chapter 194 — 第一百九十四章:那突如其來的善意 =====
```

This mode changes nothing about the MCP tools or `apicaller.py`: the agent's
`translate_chapters` still refuses more than two chapters, because an agent
spending 1,164 requests unattended is not the same as you spending them once.

## 2.1c Ask the source instead of reading it

The Chinese crawl is 4.1 MB and the chapter list in it is a mess of glued
titles and promoted page headers. Two scripts answer the questions, and they are
what you run before a batch:

```sh
python3 tools/audit_source.py                     # one-screen summary
python3 tools/audit_source.py --check 194-408     # exits 1 if the range has holes
python3 tools/audit_source.py --titles --from 194 # number -> title
python3 tools/chapter_titles.py --at 194          # from the DOCX (blank past 193)
```

Current audit: the OCR-aware local MT parser recovers chapter 241 from its
mid-body `第二自四十一卓` page header. Chapters 298 and 299 are not recognized
as standalone starts; this is a parser limitation, not proof that their text is
absent. `--check 194-408` exits 1 and names those unrecognized starts so a batch
cannot silently claim complete coverage.

The DOCX stops at Chinese 193, so `chapter_titles.py --at 194` prints a blank
title rather than inventing one. For 194+ the crawl is the only witness.

Index of every tool, and why each exists: `tools/README.md`.

## 2.2 Check the join before spending agent tokens

```sh
python3 - <<'EOF'
import sys; sys.path.insert(0, "mt")
from mcp_server import Server
r = Server(enabled_cache=False).call_tool("read_chapter", {"chapter": 194})
print(r["translation"])
print(r["paragraphs"][0])
EOF
```

Want `{'available': True, 'attached': 166, 'mismatched': 0, ...}` and a `my` field
on each paragraph. Alignment is verified per paragraph against the Chinese, so a
stale file cannot shift Burmese onto the wrong sentence.

## 2.3 Run the agent

Interactive — start Kilo, then point it at the brief and give it one task:

```sh
set -a; . ~/.env; set +a
cd "$REPO" && kilo
```

```
Read mt/quality/finetune-agent-prompt.md and follow it exactly.

Chapter 194. read_chapter first and check translation.available.
Start at paragraph 1, stop after 5 drafts, then report.
```

Three lines, because the brief already contains everything else — the register,
the procedure, the output contract, the honesty clause, and the rule that it must
not translate a chapter itself or spend API quota. The first line is what makes
the other two mean anything: without it the agent has opinions about Burmese and
no instructions.

Do not paste the brief into the chat: it is 300 lines, and pasting it into a
phone terminal is how a session gets truncated before it starts. Read it from
disk so the agent can re-read it when the context is compacted.

Headless:

```sh
set -a; . ~/.env; set +a
kilo run --auto -m groq/openai/gpt-oss-120b \
  --file mt/quality/finetune-agent-prompt.md \
  "Chapter 194. read_chapter first, confirm translation.available is true.
   Paragraphs 1-5: segment_text each 'my' text, lookup_word any word you doubt,
   save_draft with ai_text set to that same 'my' text. Stop after five."
```

`-m` beats the config file and the last-used model, so a headless run cannot
silently land on Auto Free. `--auto` is required for headless: without it every
permission request is auto-rejected and the run exits 1 even though nothing was
wrong.

## 2.3a The first test: review only, no chapter, no API

Nothing here reads the book, spends RapidAPI quota, or writes a file. It proves
the three things that break independently: the key reaches Groq, the model id
resolves through the config, and the MCP server is up with your review in it.

**Step 1 — advertise only the two review tools.** In `~/.config/kilo/kilo.jsonc`,
the MCP entry's `command` array ends with:

```jsonc
"--env-file", "/root/.env",
"--tools", "review"
```

That is 2 tools and 1,460 characters of schema instead of 18 and 12,886 — the
difference between fitting in an 8k minute and not.

**Step 2 — paste this:**

```sh
set -a; . ~/.env; set +a
cd ~/proofreading
kilo run --auto "Call review_brief with chars_per_arc 40. Nothing else: no file
reads, no other tools. Then answer with exactly three lines — characters,
sections, brief length in characters — and stop."
```

**Pass looks like this**, and the numbers are checkable:

| line | value |
|---|---|
| characters | `15` |
| sections | `111` |
| brief length | about `6890` (the raw Markdown; the JSON wrapper adds 511) |

**What each failure actually means:**

| what you see | cause |
|---|---|
| `tool 'read_chapter' is not enabled` | the model ignored "nothing else" — it still proved the server and the key work. Re-run with a firmer instruction; do not widen `--tools` |
| `413 … Requested N` / `Rate limit reached` | the declared `output` in `kilo.jsonc` is too large; it must be `1024` on free |
| `Model not found: groq/…` | the `models` block is missing, so Kilo is resolving against its stale catalog |
| tool result but no numbers | it read `markdown` and gave up — ask for `characters` and `sections` fields by name |

**Step 3 — only after that passes**, widen to the reading pass and switch to the
real first turn: change `"review"` to `"survey"` (11 tools, 7,501 characters,
adds `read_chapter`, `segment_text`, `lookup_word`, `check_names`,
`register_name`, `save_verse`), then use the prompt in 2.3b.

## 2.3b The chain, and the smallest first test

Start Kilo in the repo with the keys exported, then send **text**, not shell:

```sh
set -a; . ~/.env; set +a
cd "$REPO" && kilo
```

**First test — background only, costs nothing.** Paste this as one message:

```
Read mt/quality/START.md and follow it. Then review_brief {"chars_per_arc": 60}
and stop. Report the 15 characters, the three known defects, the reviewer's
verdict and every arc title, then state the register you will enforce.
```

`START.md` is 3,320 characters; `finetune-agent-prompt.md` is 25,791. The card
is the difference between a first turn that costs ~1k tokens and one that costs
~8k before any work happens — and the manual is not read at all until you start
drafting.

You want back: 15 characters, the three known defects, the reviewer's verdict,
every arc title. If the tool is missing from `/mcps`, the MCP server is not
running — fix that before anything else.

### If the session dies with "Compaction exhausted"

That is a token-budget failure, not a broken tool. **Check which Groq plan the
key belongs to before changing anything else**, because the two plans are not
close:

| plan | TPM | RPM | RPD | TPD |
|---|---|---|---|---|
| **Free** (no card) | **8,000** | 30 | 1,000 | 200,000 |
| Developer (card on file) | 250,000 | 1,000 | 500,000 | none |

`openai/gpt-oss-120b` is the same model on both; only the ceilings differ. The
8,000 figure is what the console shows as "Rate Limit" on the usage chart, and
`150% consumed` means one turn asked for 12k tokens in a minute that allowed 8k.

The exact limits for your own organisation are on the limits page in the Groq
console (Settings → Limits) — the docs table is a sample.

**On the free plan an agent loop cannot run at all**, and trimming does not save
it: the 18 MCP tool schemas alone are ~3.2–4.3k tokens, and they are re-sent with
every request. Add `START.md` (~1.0k) and one `review_brief` (~2.4k) and the
first two turns already exceed 8k. Kilo then shows the failure as "context
exceeds model limits" because compaction is what gives up first — read it as
rate, not size.

Measured costs. Character counts are exact; token counts are a **range**, because
the Myanmar script tokenizes far worse than English and no local tokenizer here
can be trusted for it (the BPE file that `tiktoken` downloads is unreachable from
this sandbox — do not try to install it on the VPS either, it needs the same
host).

| what | chars | tokens (est.) |
|---|---|---|
| `mt/quality/START.md` | 3,419 | **0.9k – 1.2k** |
| `mt/quality/finetune-agent-prompt.md` | 26,283 | **6.9k – 9.3k** |
| 18 MCP tool schemas (every turn) | 12,886 | **3.2k – 4.3k** |
| `review_brief {}` | 14,431 | **8.1k – 13.2k** |
| `review_brief {"chars_per_arc": 60}` | 7,766 | **4.1k – 6.5k** |
| `read_chapter` 10 paragraphs | 2,053 | **0.6k – 0.8k** |
| `read_chapter` whole 166 | 13,255 | **4.6k – 6.5k** |

Calibration: the console screenshot that started this showed **10.7k input** for
the turn that read the manual with the tools attached — manual (~6.9k) plus
schemas (~2.7k) plus Kilo's own prompt lands right on it. Trust the **low** end
of each range when nothing is cached.

The uncomfortable number is `review_brief`: the review is 10,495 characters of
Myanmar script, so the default digest alone is roughly the whole of Groq's free
minute. That is why `{"chars_per_arc": 60}` is the default in the card and the
chain — and why the free plan cannot run this at all, at any trim.

What fixes it, in order:

1. **Put a card on the Groq account (Developer plan).** No minimum spend; you
   pay only for tokens. A 10-turn session at ~10k input per turn is ~100k
   input tokens ≈ **$0.015**, plus a few thousand output tokens. This is the
   only fix that makes the free 8k ceiling stop mattering, and it changes
   nothing in the config — the model id stays `groq/openai/gpt-oss-120b`.
2. **Start from `START.md`, never from the manual** — worth ~7k on turn one even
   on the paid plan, because every turn re-sends the transcript.
3. **Window `read_chapter`** — `{"start": 1, "count": 10}`, then follow
   `window.next_start`. Ten at a time is ~0.7k; the whole chapter is ~13k and
   is re-sent on every later turn.
4. **`"output": 16000`** on the Developer plan, down from 32,000 — generated
   tokens are billed against the same budget and this model narrates. On the
   **free** plan use `2048`: some Groq endpoints reject a request whose declared
   `max_tokens` alone exceeds the ceiling (413 "Limit 8000, Requested 8271"),
   so a 16k reservation can fail before a single token is generated.
5. **One chapter per session.** Not two.
6. If a session already says `Compaction exhausted`, start a new one: the
   context is gone and retrying only spends more of the minute.

### Cerebras (card-gated — skip unless a card exists)

> **Both Cerebras tiers need a verified payment method.** With no card this
> section is reference only; the card-free lanes are in *Which one to actually
> use* below.

`gpt-oss-120b` is served by Cerebras too, with the **per-minute token budget as
the difference** — this is the number that matters, not the context window:

| provider / tier | TPM | RPM | daily | context |
|---|---|---|---|---|
| Groq free | 8,000 | 30 | 200,000 | 131,072 |
| Groq Developer *(card)* | 250,000 | 1,000 | none | 131,072 |
| **Cerebras Free Trial** *(card, 30 days)* | **30,000 uncached / 90,000 total** | **5** | 1M tokens/day | **65,536** |
| Cerebras Developer *(card)* | 1,000,000 uncached / 3M total | 1,000 | none | 131,072 |

Two things to read carefully:

- **"120" in the product name is the parameter count** — 120 billion — not a
  token count. The context is 65k on the free trial and 131k paid, so a Kilo
  config that says `131072` will over-commit on the free tier and compact too
  late; the provider answers with a 400. Set `65536` there.
- **5 RPM is the real constraint**, not the 30k TPM: a tool-calling turn is two
  or three requests (model → tool, tool result → model), so the free trial
  affords roughly two turns a minute. That is fine for a human typing, useless
  for a loop. Cerebras also publishes 30k *uncached* against 90k *total* TPM,
  which means the repeated static prefix — the 18 tool schemas and
  `START.md` — can be discounted by prompt caching. Confirm on your own usage
  page rather than trusting it.

The trial needs a verified card for $5 of credit that expires after 30 days;
there is no permanently free tier. Kilo ships a built-in `cerebras` provider,
so nothing but the config changes:

```sh
echo 'CEREBRAS_API_KEY=your_key' >> ~/.env
set -a; . ~/.env; set +a

cat > ~/.config/kilo/kilo.jsonc <<EOF
{
  "\$schema": "https://app.kilo.ai/config.json",
  "model": "cerebras/gpt-oss-120b",
  "provider": {
    "cerebras": {
      "env": ["CEREBRAS_API_KEY"],
      "models": {
        "gpt-oss-120b": {
          "tool_call": true,
          "limit": { "context": 65536, "output": 16000 }
        }
      }
    }
  },
  "mcp": {
    "rapidapi-translator": {
      "type": "local",
      "command": ["$(command -v python3)", "$REPO/mcp.py", "--serve",
                  "--env-file", "$HOME/.env"],
      "enabled": true
    }
  }
}
EOF

kilo models cerebras          # the id must appear before you rely on it
```

Later, if you go back to Groq, swap the `model` line back to
`groq/openai/gpt-oss-120b` and keep everything else — the tools, the card and
the chain are provider-independent.

### Which one to actually use — starting from no card

A card is a wall, not a price. Groq's Developer plan and both Cerebras tiers
(Trial and Developer) require a verified payment method, so on this account they
are not expensive — they are **unavailable**. Everything below is card-free:

| lane | card | free ceiling | can it carry the loop? |
|---|---|---|---|
| **Gemini API** (AI Studio) | no | not published; per project, in AI Studio | best lane **if** your region is on the list |
| **Cloudflare Workers AI** | no | 10,000 neurons/day | **~38 turns/day** — `@cf/openai/gpt-oss-120b`, the same weights |
| **OpenRouter `:free`** | no | 50 requests/day, 20 RPM | ~2 ten-paragraph windows a day |
| **Groq free** | no | 8,000 TPM, 200,000 TPD | no: dies around turn 5 (see below) |

The RapidAPI translation step is untouched by any of this — that key is separate
and still works. Only the agent needs a provider.

**Run this first; it decides everything.** Gemini is the best of the four *if*
you are allowed to call it. Myanmar is not on Google's available-regions list, so
a key can exist while every request fails. One request, no configuration:

```sh
set -a; . ~/.env; set +a
curl -s -w '\nHTTP %{http_code}\n' \
  "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
  | head -20
```

* `HTTP 200` and a list of models → **use Gemini**, go to *Lane A*.
* `HTTP 400` with `FAILED_PRECONDITION: User location is not supported` →
  Google will not serve this account from here, whatever the key. Go to *Lane B*.

#### Lane A — Gemini (only if the check passed)

Kilo has a built-in `google` provider; the key goes in
`GOOGLE_GENERATIVE_AI_API_KEY` and the model is `google/<id>`. Take the id
straight from the list the curl printed (strip the `models/` prefix):

```sh
kilo models google        # or read the curl output: "name": "models/gemini-…"
```

```jsonc
// ~/.config/kilo/kilo.jsonc
{
  "$schema": "https://app.kilo.ai/config.json",
  "model": "google/<the-id-from-the-list>",
  "provider": {
    "google": { "options": { "apiKey": "{env:GOOGLE_GENERATIVE_AI_API_KEY}" } }
  }
}
```

Google no longer publishes RPM/TPM/RPD for the free tier — your own numbers are
on the **AI Studio → rate limits** page for the project the key belongs to. Read
them once before a long session. Keep `"output"` modest on free (`4096` is
plenty for a ten-paragraph judgement) and start the MCP server with
`--tools lean` so the request stays small (`--tools` is below).

#### Lane B — Cloudflare Workers AI (no card, no region gate)

Sign up at `dash.cloudflare.com` (email only, no card, no phone). Then
**Workers & Pages → AI**, and create an API token with the *Workers AI* permission.
You need two values: the **account id** (right-hand column of the dashboard) and
the **token**.

It serves `@cf/openai/gpt-oss-120b` — **the same weights as the Groq plan**, so
every number in the comparison table above still applies to it.

The allowance is neurons, not tokens:

| | per 1M tokens | a ten-paragraph turn (~7k in, 600 out) |
|---|---|---|
| input | 31,818 neurons | ~223 |
| output | 68,182 neurons | ~41 |
| **total** | | **~264 neurons** |

10,000 neurons a day / 264 ≈ **38 turns**. One two-window pass (20 paragraphs)
is ~20 turns and ~5,300 neurons — about half the daily allowance, so one pass a
day with enough left to retry a turn. A 166-paragraph chapter is eight such
passes, so roughly **four to five days a chapter** on this lane, and 212
chapters is not a schedule anyone should plan around. That is the honest
arithmetic: free enough to build and judge the chain, not to finish the book.

Kilo talks to it through the generic OpenAI-compatible provider:

```sh
printf 'CLOUDFLARE_API_TOKEN=...\nCLOUDFLARE_ACCOUNT_ID=...\n' >> ~/.env
```

```jsonc
// ~/.config/kilo/kilo.jsonc
{
  "$schema": "https://app.kilo.ai/config.json",
  "model": "workers-ai/@cf/openai/gpt-oss-120b",
  "provider": {
    "workers-ai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cloudflare Workers AI",
      "options": {
        "baseURL": "https://api.cloudflare.com/client/v4/accounts/{env:CLOUDFLARE_ACCOUNT_ID}/ai/v1",
        "apiKey": "{env:CLOUDFLARE_API_TOKEN}"
      },
      "models": {
        "@cf/openai/gpt-oss-120b": {
          "name": "gpt-oss-120b (Workers AI)",
          "tool_call": true,
          "limit": { "context": 128000, "output": 4096 }
        }
      }
    }
  }
}
```

Prove the pair of values before writing the config — the account id is in the
URL, so a wrong one is a `7003` before the model is even reached:

```sh
set -a; . ~/.env; set +a
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/v1/chat/completions" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"@cf/openai/gpt-oss-120b","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}'
```

If it complains the context is smaller than 128k, drop `limit.context` to
`65536` — Kilo only uses that number to decide when to compact.

#### Lane C — OpenRouter `:free` (the spare tire)

No card, twenty requests a minute, **fifty a day** until the account has bought
$10 of credits in its lifetime. A ten-paragraph window pass is ~20 requests, so
this is two windows a day — comparable to Lane B, and useful as a second opinion
on the same paragraph because it is a different serving stack.

```sh
printf 'OPENROUTER_API_KEY=...\n' >> ~/.env
curl -s -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  https://openrouter.ai/api/v1/models | grep -o '"id":"openai/gpt-oss-120b:free"'
```

If that prints nothing, `gpt-oss-120b` is not in the free roster that week (it
comes and goes) — pick any id ending in `:free` from the same list, and accept
that the register judgement will differ from the Groq baseline. Kilo has a
native provider, so the config is just `"model": "openrouter/<that-id>"`.

#### Why Groq free still does not work

Not the daily cap — the **per-minute** one. 8,000 TPM is the whole bucket, so a
single request bigger than 8,000 tokens is refused before it is generated
(`413 Limit 8000, Requested N`), and waiting does not help. Kilo re-sends the
conversation each turn, so at ~1.2k tokens of growth per turn the fifth or sixth
turn crosses 8k and every turn after it fails. `--tools lean` (schemas 10.7k →
5.5k characters, ~3.4k → ~1.7k tokens) buys about two turns; it does not make
the loop fit. Keep the key for one-shot questions; do not start a session on it.

#### If a card ever appears

Then, and only then, re-read the table: **Groq Developer** is ~17 turns a minute
at $0.0027/turn (~$0.054 a chapter) against **Cerebras trial**'s ~2 turns a
minute and 30-day expiry — same weights, so half the price and 200× the request
rate wins on every axis that matters here.


## 2.4 Inspect the result

```sh
sqlite3 content/mtranslate/agent-drafts.sqlite3 \
  "select paragraph_index, note, substr(draft_text,1,40) from drafts where chapter=1"
```

Or from inside the agent session: `export_drafts {"chapter": 1}`.

---

# Part 3 — Command reference

All flags below are copied from `--help`; run any of them with `--help` for the
same text.

## `mt/apicaller.py` — the two-chapter caller

| flag | meaning |
|---|---|
| `194 195` (positional) | chapters to translate, as bare numbers |
| `--194&195` `--194+195` `--194,195` `--194-195` | the same pair written as one token; `&` needs quoting |
| `--chapters` | explicit spec, `next`, or omitted for the cursor |
| `--status` | human span, chapters done and left, next pair; no request |
| `--plan` | count the pair, no request (default) |
| `--run` | call the API; needs `RAPIDAPI_KEY` |
| `--target` | target language, default `my` |
| `--source` | source language or `auto`, default `auto` |
| `--source-file` | Chinese text with `===== 第N章 =====` headings |
| `--existing` | human Burmese, used as the comparison reference |
| `--docx` | bilingual DOCX the chapter numbers come from |
| `--map` / `--no-map` | saved chapter map; or assume Chinese N = Burmese N |
| `--out-dir` | output directory, default `content/mtranslate/rapidapi` |
| `--cache` / `--no-cache` | translation cache |
| `--no-compare` | skip the comparison markdown |
| `--max-chars` / `--max-items` | request limits |
| `--timeout` / `--attempts` | per request |
| `--json` | the plan, report or status as one object |
| `--env-file` | read `KEY=VALUE` lines from PATH; the shell wins |

## `mt/api_translate.py` — the batch engine under it

| flag | meaning |
|---|---|
| `--chapters` | `1-2`, `1,3-4`, `all`, `next`, `last`, `existing`. Default `1-2` |
| `--target` | target language, default `my` |
| `--source` | source language or `auto`, default `auto` |
| `--source-file` | Chinese text with `===== 第N章 =====` headings |
| `--existing` | human Burmese for the comparison reference |
| `--docx` | bilingual DOCX the chapter numbers come from |
| `--map` | saved chapter-map JSON; skips reading the DOCX |
| `--no-map` | assume Chinese N = Burmese N |
| `--out-dir` | output directory, default `content/mtranslate/rapidapi` |
| `--cache` | SQLite cache path |
| `--no-cache` | ignore the cache |
| `--keep-notes` | keep author notes and promo lines |
| `--no-compare` | do not write the comparison file |
| `--max-chars` | characters per request (API limit 5,000) |
| `--max-items` | strings per batch request |
| `--timeout` | per-request timeout |
| `--attempts` | retries per request |
| `--json` | print the report as JSON |
| `--env-file` | read `KEY=VALUE` lines from PATH; the shell wins |
| `--plan` | offline count, no request (default) |
| `--run` | actually call the API; needs `RAPIDAPI_KEY` |
| `--one-file [PATH]` | write one `.txt` and nothing else; no cache, jsonl, report. Default `content/mtranslate/english.txt` |
| `--skip-missing` | translate the chapters that exist when the range has holes (on by default with `--one-file`) |
| `--pause` | seconds between chapters (default `0.5`) |

## `mcp.py` — one flag per tool, or the agent's tool server

Run `uv run mcp.py` from the repository root. With no command it prints help
and runs nothing. The 18 MCP tools are also direct CLI commands (for example,
`--read_chapter`, `--segment_text`, `--review_brief`, `--translate_text`); the
short hyphenated aliases work too. The source-inspection tools are
`--insecpt`/`--inspect` and `--getTitle`. To start the stdio server explicitly,
use `--serve`; MCP clients must use that flag.

| flag | meaning |
|---|---|
| `--print-config` | print a client snippet and exit |
| `--client` | `json`, `claude`, `kilo`, `codex`, `gemini` |
| `--check` | print configuration state, no request |
| `--install-config` | write/merge the entry into the client config |
| `--config` | config file for `--install-config` |
| `--env-file` | load keys from PATH at startup (also `RAPIDAPI_ENV_FILE`) |
| `--selftest` | protocol round-trip, no network |
| `--cache` / `--no-cache` | translation cache |
| `--source-file` | Chinese source for `translate_chapters` |
| `--existing` | human Burmese for the comparison |
| `--out-dir` | default output directory |
| `--docx` | bilingual DOCX for chapter numbers |
| `--draft-store` | SQLite file for agent drafts |
| `--max-chars` `--max-items` `--timeout` `--attempts` | request limits |
| `--tools` | advertise only some tools: a preset, a group, or names (below) |
| `--list-groups` | print the groups, their sizes, and exit |

**Eighteen tools — and you pay for all of them every turn.** The schemas are
12,886 characters (~3.2–4.3k tokens) and Kilo re-sends them with every request,
so on a small free budget they are a third of the minute before the model has
read a word. `--tools` narrows what the process advertises:

| spec | tools | schema chars | when |
|---|---|---|---|
| *(none)* | 18 | 12,886 | nothing to save |
| `--tools lean` | 7 | 5,468 | the smallest loop that still edits: read ten, segment, check a name, save a draft |
| `--tools survey` | 11 | 7,501 | the read-only first pass: review digest, names, verse |
| `--tools edit` | 11 | 7,398 | rewriting paragraphs; no review digest, no API |
| `--tools review` | 2 | 1,460 | one `review_brief` question on an 8k-per-minute key |
| `--tools review,names` | 5 | 3,282 | groups instead of presets, comma-separated |
| `--tools english-review` | 7 | 5,448 | English comparison + prior Burmese context + review + names |

Groups: `read` `english` `review` `names` `verse` `draft` `api`. Presets:
`survey` `edit` `lean` `translate` `english-review` `full`. A tool that is not advertised is refused if called,
with the flag named in the error — no silent empty answer. Verify the arithmetic
on your own machine:

```sh
uv run mcp.py --list-groups
```

The four the agent needs before it judges anything:

| tool | use |
|---|---|
| `review_brief` | the review in one round — characters, defects, verdict, arc openings |
| `lookup_name` | one `EtoBnames.txt` entry by key or Burmese form |
| `check_names` | names present in a paragraph, plus suspected variant spellings |
| `register_name` | append a new term to `EtoBnames.txt` |
| `compare_english_chapter` | one window of Chinese, local MT English, and API English, aligned by paragraph |
| `previous_burmese_context` | Burmese-only keyword lines from the two Chinese chapters before the required current chapter |

Local English task examples (no API call):

```sh
uv run mcp.py --compare_english_chapter 194 --start 1 --count 10
uv run mcp.py --previous_burmese_context "နတ်" --chapter 194
uv run mcp.py --serve --tools english-review  # expose only this read-only task set
```

## `mt/translate.py` — Chinese/English routes

| flag | meaning |
|---|---|
| `--route` | `zh-en` or `en-zh`; repeatable |
| `--engine` | `offline`, `azure`, `cmd` |
| `--cmd-template` | shell command for `cmd`; `{text}` or stdin, `{source}`/`{target}` substituted |
| `--engine-note` | model id recorded in `report.json` |
| `--source-file` | Chinese text |
| `--limit` | first N chapters |
| `--only` | chapter number; repeatable |
| `--out-dir` | output directory |
| `--list` | route availability, then exit |
| `--resume` | skip chapters that already have output |
| `--cascade` | `zh-en` first, then `en-zh` which reads it |
| `--one-file [PATH]` | one resumable text output only; requires one explicit route |
| `--input-file` | one-file zh-en input for the `en-zh` route |
| `--chapters LOW-HIGH` | inclusive range for one-file runs (default `1-408`) |

## `mt/agent_work.py` — drafts without an agent host

| command | purpose |
|---|---|
| `read <chapter>` | `--reference-lines N`, `--no-reference` |
| `save <chapter> <paragraph>` | `--draft` or `--draft-file`, `--ai-text`, `--model`, `--note` |
| `note <chapter> <paragraph>` | attach a note to an existing draft |
| `export <chapter>` | `--out-dir`, `--require-all` |
| `list` | drafts in a chapter, or all chapters |
| `stats` | totals for the store |

Global: `--store` (SQLite path), `--source`, `--existing`, `--docx`, `--json`.

## `mt/chapter_map.py` — chapter numbers from the DOCX

| flag | meaning |
|---|---|
| `--docx` | bilingual DOCX |
| `--at` | look up Chinese chapter N; repeatable |
| `--burmese` | look up Burmese chapter N; repeatable |
| `--json` | print the whole map |
| `--write` | save the map as JSON |

## `mt/lexicon.py` — dictionary and segmentation probes

Read-only over `Engine/`. Never writes `master.json`, the tree, or the caches.

| function | question |
|---|---|
| `lookup(word)` | is this an entry, which POS family, is it reachable, is there a dictionary-proved repair |
| `coverage(text)` | which characters no entry or syllable can explain |
| `suggest(text)` | proved repairs for storage-order damage |
| `segment(text)` | tokens, smallest units, split verdicts, coverage |

CLI: `--lookup WORD`, `--coverage TEXT`, `--suggest TEXT`, `--segment TEXT`.

Split verdicts: `word` (entry), `unit` (known syllable), `loan` (a virama stack
the inventory still cannot name — rare, since the tree now carries all 732 Pali
units), `unknown` (neither — the only suspect bucket).

### Rebuilding the syllable tree

The tree in `Engine/.cache-tree/` is built from the sealed master in
`Engine/MonoSyllabism/map/master.json.enc`. Rebuild it whenever the syllable
lists or the builder change — never edit the four files by hand.

```sh
node --import ./scraper/wasm/box/runtime-guard.mjs mt/rebuild_tree.mjs
```

The guard import is required: the builder calls `MyNormalize()`, which lives in
the WASM. It prints the unit count and the four hashes, then rewrites
`Engine/CACHE-SOURCE.json` — `tag-text.mjs`, `mt/quality/tag-both.mjs` and
`mt/quality/units.mjs` all verify the cache against that file, so a stale hash
fails loudly instead of silently tagging with an old tree.

The build is deterministic: burmese first, then pali, so every existing unit
keeps its id. `--out DIR` writes elsewhere; `--no-record` leaves the manifest
alone.

`runBuild` writes only the four cache files. Do **not** use `runBuildPos` to
regenerate them: it prunes dictionary rows from the master it is handed, which
is why `tag-both.mjs` gives it a scratch copy.

### Is the WASM current?

```sh
node scraper/wasm/box/tools/verify-payload.mjs
```

It decrypts the payload inside `box.wasm` and diffs all four modules and the
API shim against the sources on disk. Exit 0 means the binary **is** the code
you are reading — no rebuild. The tree is data: it lives outside the WASM, so a
tree rebuild never needs a new binary.

### Rebuilding the WASM, with or without `engine.wasm`

`box.wasm` is two parts: `engine.wasm` (QuickJS compiled) plus a payload built
from the four `mapbuilder/base` files and `mapData`. `build-payload.mjs`
**inlines `mapData`**, so any edit to `master.json` needs a new binary, and a
stale one is caught by the check above.

Repack only — needs no C toolchain, uses the tracked `engine.wasm`:

```sh
cd scraper/wasm/box
node build-payload.mjs && node tools/pack-box.mjs && node tools/record-build.mjs
cd ../../.. && node scraper/wasm/box/tools/verify-payload.mjs
```

`record-build.mjs` is not optional: `host.mjs` refuses to boot a `box.wasm`
whose sha256 does not equal `build-info.json.box_sha256`.

Full rebuild from source — no `engine.wasm` required; it is generated, not
authored:

```sh
python3 -m pip install "ziglang==0.17.0"
git clone --depth 1 -b v0.17.0 https://github.com/quickjs-ng/quickjs.git /tmp/qjs-ng
QJS_SRC=/tmp/qjs-ng sh scraper/wasm/rebuild-box.sh
```

Two facts worth knowing before trusting a hash:

- `engine.wasm` **is** byte-reproducible (`8cef309a…`) as long as the output
  file keeps that exact name — zig writes the output basename into the wasm
  `name` section, so building to `engine-test.wasm` changes 25 KB of the file.
- `payload.bin` and therefore `box.wasm` are **not** reproducible: the payload
  is AES-256-GCM with a fresh IV, and the loader is obfuscated with a random
  seed. Five packs of identical sources gave five different `box_sha256`
  values. `verify-payload.mjs` is the check that matters; it compares decrypted
  *contents*, not the file hash.

## `mt/overview_index.py` — the background document

| flag | meaning |
|---|---|
| `--index` | index file to read or write, default `content/review/overview.yaml` |
| `--build` | regenerate `content/review/overview.yaml` |
| `--find TEXT...` | sections mentioning every word |
| `--get ID` | print one section by id |
| `--chapter N` | the arc covering chapter N (compact map) |
| `--section` | with `--chapter`: `story`, `opinion`, `problems`, `title` |
| `--titles` | list ids only |
| `--limit` | max sections printed by `--find` |
| `--verify` | re-check every range against the markdown |
| `--brief` | the whole review in one round: characters, defects, verdict, every arc's opening (≈35k chars) |
| `--chars-per-arc N` | story characters per arc in `--brief`, default 420; `200` ≈ 25k, `60` ≈ 18k |

## `mt/names.py` — the name list (`content/reference/EtoBnames.txt`)

The list is the authority for Burmese spelling. The agent reads it before it
judges and appends to it when a genuinely new term appears.

| flag | meaning |
|---|---|
| `--list` | every entry, with line numbers |
| `--lookup TERM` | one entry by English key or by Burmese form |
| `--check --text '…'` | canonical names in a fragment, and suspected variants |
| `--check --chapter N` | the same over `chNNNN.my.jsonl` |
| `--add 'KEY = BURMESE'` | append a new entry, dated; refuses a duplicate key or a form owned by another key |
| `--warnings` | duplicate forms, reversed lines, and prose skipped |
| `--json` | the same report as one object |
| `--file` / `--translations` | override the list or the `mtranslate` directory |

Everything except `--add` is read-only. `--add` only appends; it never rewrites
an existing line.

An entry is two sides and nothing else, exactly as the 129 existing lines are:
the **English** as the zh-en column writes it, and the **Burmese** form the AI
translation used (corrected by the agent when wrong). No categories. A term is
not only a person — a weapon, a martial art, a bloodline ability, a pill, a rank
or a place is registered the same way, and `Golden Eagle Saber` is the case to
remember: easy to translate is not the same as safe to leave to the API.

A trailing `# …` note is stripped before the form is compared. Before that fix,
`--add --note` wrote a note into the form and the entry could never match the
text it was added for.

```sh
python3 mt/names.py --lookup "Liu Jin"
python3 mt/names.py --check --chapter 194
python3 mt/names.py --add 'Shen Ji = ရှန်းကျီ'
```

## `mt/verse.py` — poems and philosophy lines, for review

**It does not find verse.** Whether a line is a poem, a song, a maxim or a
throwaway quotation is a judgement, and the agent that re-matches tone is
already holding the paragraph. A regex that guessed would either bury real
couplets among ordinary sentences or miss them. The agent decides; this stores
the decision and renders the section.

```sh
python3 mt/verse.py mt 194                    # numbered zh-en lines, to quote from
python3 mt/verse.py add 194 --paragraph 161 --kind poem \
    --english "Even the wind has grown weary of blowing." --source own \
    --note "closes the elegy, four parallel lines"
python3 mt/verse.py add 194 --kind none --note "read twice, no verse"   # or none
python3 mt/verse.py list 194
python3 mt/verse.py export 194                # -> content/mtranslate/verse/ch0194.verse.md
```

| flag | meaning |
|---|---|
| `--kind` | `poem`, `philosophy`, `song`, `inscription`, `maxim`, `other`, or `none` for "checked, nothing" |
| `--paragraph` | 1-based index or paragraph id from `read_chapter`; required unless `kind none` |
| `--english` | the English version — the point of the section |
| `--source` | `mt` (zh-en verbatim), `own` (agent's rendering), `mixed` (quoted then rewritten) |
| `--mt-english` | the zh-en line you started from, so both are visible |
| `--note` | why it is verse, and what to watch in the Burmese |

The store is `content/mtranslate/verse/chNNNN.verse.jsonl` — one record per
paragraph, so a re-save replaces rather than appends. `export` writes the
markdown the human reviews: Chinese, the zh-en line, the English, and the note.
`mt/agent_work.py export` and the `export_drafts` tool append that section to
the end of the chapter comparison file whenever verse exists, so the review copy
and the verse sit together. Nothing here touches the draft text, the AI
translation, the name list or the engine.

## `mt/quality/profile.py` / `mt/quality/tag.py` — the numbers behind "tone"

Both are read-only and take `--chapter N` (repeatable), and both read the
**human Burmese chapters** — they measure the target, not the AI text. That is
what makes a register claim checkable instead of an opinion.

```sh
python3 mt/quality/profile.py --chapter 1 --chapter 2 --json /tmp/profile.json
python3 mt/quality/tag.py --chapter 1
```

`profile.py` prints sentence and word counts, words per sentence with median and
p90, the top words, and the particle counts — `၏` / `ရဲ့`, `တွင်` / `မှာ`,
`များ` / `တွေ` — which is exactly the narration/dialogue split the brief
enforces. `tag.py` dumps the word view with POS families via
`mt/quality/tag-both.mjs` (both views, scratch dir, nothing under `Engine/`
written).

To measure the AI text itself, use the MCP tools inside the session:
`segment_text` returns tokens, units, tags, split counts and coverage, and
`check_names` returns the canonical/variant pairs. There is no CLI equivalent
on purpose — those two read whatever text you hand them, and the chapter files
are not the only place the text lives.

## `mt/mt_compare.py` — the reference audit (one-off, not per chapter)

Read-only, zero API calls, but it profiles the **whole reference** first, so it
is a once-per-checkout audit rather than a step in the chain:

```sh
python3 -m pip install --break-system-packages 'json5>=0.12,<1'   # its only dependency
python3 format/tag_docx.py            # writes content/kmt-pos/ယဲ့နင်.raw_pos.txt (~6.3 MB of prose)
python3 mt/mt_compare.py --profile    # writes content/analysis/reference-data-audit.json
```

`--input FILE.jsonl` scores MT candidate records against that profile and writes
`output/mt/<name>-comparison.jsonl`. It does **not** by itself resolve
compounds or sentences — its own output says so.

## `mt/fetch_engine.py` / `format/fetch_dicts.py`

| flag | meaning |
|---|---|
| `--install {zh-en,en-zh}` | clone and unpack one model |
| `--all-available` | install both routes |
| `--check` | what is installed, with size; writes nothing |
| `--remove {zh-en,en-zh}` | delete one model |
| `--package-dir` | package directory, default `$XDG_DATA_HOME/argos-translate/packages` |
| `--json` | the report as one JSON object |
| `fetch_dicts.py --force` | rebuild dictionaries even if present |

---

# Part 4 — What goes wrong

| symptom | cause |
|---|---|
| `kilo run` exits 1 with a permission diagnostic | missing `--auto` |
| `401` from Groq | `GROQ_API_KEY` value is wrong, or the line is still `groq=key` |
| `/status` shows Auto Free after you set a model | the key was not exported, or the model id is not in `kilo models groq` |
| `kilo models groq` lists only `meta-llama/llama-prompt-guard-2-*` | those are prompt-injection **classifiers**: 22M/86M parameters, a **512-token** window, and the answer is a single 0–1 score, not prose. Kilo's Groq catalog is stale after the 2026 retirements and these are what survived. Declare `openai/gpt-oss-120b` under `provider.groq.models` — the declaration is what makes it resolvable |
| `Model not found: groq/llama-3.3-70b-versatile` | Groq **retired that id on 2026-08-16** for free and developer keys (enterprise keeps it). There is no Groq setting to enable — the id is gone. Use `openai/gpt-oss-120b`, the replacement Groq itself names |
| `Model not found` for an id that *is* in `kilo models groq` | one malformed entry under `provider.<id>.models` rejects the whole provider block (Kilo issue #14766). Every entry needs both `limit.context` and `limit.output` |
| bare `kilo` exits with `UnknownError … ref err_…` | a Kilo-side crash, not a Groq refusal; use `kilo run`, and check the config parses with `kilo models groq` before reading anything into it |
| edits look like a different model wrote them | a session-level pick overrode `kilo.jsonc`; `/models` to reset, or pass `-m` |
| `/mcp` shows no server | `kilo.jsonc` path wrong, or python path in `command` is wrong |
| `--194&195` returns to the prompt, then `195: command not found` | unquoted `&`; use `'--194&195'` or `--194+195` |
| `2 at a time` refusal | intended: run the pairs it prints, in order |
| `read_chapter` has no `my` field | `apicaller.py --run` has not produced that chapter |
| Pali words split at every `္` (`ဗု · ဒ · ္ဓ`) | old cache: the loader stopped after `burmese`. Rebuild with `mt/rebuild_tree.mjs` |
| `Original scraper cache hash mismatch` | the tree was edited by hand; rebuild it, never patch the four files |
| `Master mapData.* differs from the built WASM` | `mapData` was edited; check with `scraper/wasm/box/tools/verify-payload.mjs` before rebuilding the binary |
| `engine.wasm` missing / `zig: not found` | repack only: `build-payload.mjs`, `pack-box.mjs`, `record-build.mjs`; or install `ziglang==0.17.0` and see *Rebuilding the WASM* |
| `box.wasm` hash changed after a rebuild | expected — payload IV and loader obfuscation are random; compare `verify-payload.mjs` output, not `box_sha256` |
| a name keeps changing between chapters | it was never in `EtoBnames.txt`; `names.py --add` it once, then reuse |
| `--add` refuses with "already owns" | the Burmese form belongs to another key — reuse that key, or pick a different form deliberately |
| `translation.attached` is 0 but `available` is true | the jsonl exists but its `source` lines no longer match the Chinese — regenerate it |
| `ModuleNotFoundError: No module named 'argostranslate'` | old copy of `mt/fetch_engine.py`; `git pull` — it unpacks the zip itself now |
| `uv run` says the model is missing, `python3` finds it | two interpreters; see 1.1 and use `python3` |
| `--check` lists `zt-en`, `en-my`, `zh-my` | old copy; the only routes are `zh-en` and `en-zh` |
| `no offline model installed` | `python3 mt/fetch_engine.py --install zh-en` |
| `{?}` tags in segmentation | not an error; 2 of 3 are engine coverage, not text damage |
| the agent "fixes" `အေခြအေန` in the reference | it is editing the tone reference; it must never be edited |
