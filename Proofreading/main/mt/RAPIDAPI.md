# RapidAPI translator — chapter runs and MCP

## Vocabulary, because two of these are easy to confuse

| name | produced by | what it is |
|---|---|---|
| **AI translation** | this RapidAPI caller | the text the proofreading agent judges and rewrites |
| **MT** | `mt/translate.py --route zh-en` (Argos, offline) | Chinese → English only. No Burmese MT exists; see `MT.md` |
| **reference** | `content/merged/episodes.docx` | human Burmese translation; style oracle, carries PDF→DOCX encoding damage |

The API does **not** return MT. It returns AI-translated text and should never
be referred to as MT in prompts, notes, or column names (`save_draft` takes
`ai_text`). The only local machine translation left is Chinese → English, which
exists so an agent can read the source; it never produces Burmese.

Three files:

| file | what it is |
|---|---|
| `mt/rapidapi_translator.py` | the API client: three endpoints, cache, retries, redaction |
| `mt/apicaller.py` | the caller you run: exactly two chapters per call, starting behind the human translation |
| `mt/api_translate.py` | the batch engine under it; writes the JSONL, TXT, comparison and report |
| `mcp.py` | single CLI for the same tools plus local MCP server (stdio) |

Nothing needs installing: all four are standard-library Python 3.10+.

## Why the API looked complicated

It is three endpoints with three different body formats, and the RapidAPI
playground only shows one of them at a time:

| endpoint | query | body | response |
|---|---|---|---|
| `POST /detect` | — | raw text, `Content-Type: text/plain` | `data.language`, `data.language_name` |
| `POST /translate` | `?source=auto&target=my` | raw text, `Content-Type: text/plain` | `data.translated_text` |
| `POST /translate/batch` | `?source=auto&target=my` | JSON **array** of strings | `data.translated_texts`, same order |

Every response is wrapped as `{"status": true, "data": {...}}`. The JSON you
pasted (`{"status": true, "data": {"language": "", "language_name": {}}}`) is the
**detect response example**, not a request body — that is why it looked wrong.
Do not send it as a body.

`/translate/batch` is the endpoint to use for a chapter: one request carries an
array of paragraphs and returns them translated in the same order.

Headers on every call:

```
X-RapidAPI-Key: <your key>
X-RapidAPI-Host: multi-format-ai-translator-the-most-complete.p.rapidapi.com
```

The client builds all of that for you.

## Key

The key is read from `RAPIDAPI_KEY` in your shell and is never written to disk,
logged, or included in an error message. Type it without putting it in history:

```sh
read -rsp 'RapidAPI key: ' RAPIDAPI_KEY; echo
export RAPIDAPI_KEY
```

### Keeping it in `.env` instead

`.env` is already gitignored here, but nothing reads it implicitly — that is
deliberate, so a key file can never be picked up by accident. Point a tool at it
explicitly with `--env-file`, or set `RAPIDAPI_ENV_FILE` once:

```sh
cat > .env <<'EOF'
RAPIDAPI_KEY=your-key-here
EOF
chmod 600 .env

python3 mt/apicaller.py --plan --env-file .env              # 194 + 195
python3 mt/apicaller.py --run  --env-file .env              # spends quota
python3 mt/apicaller.py --196+197 --run --env-file .env     # the next pair
python3 mt/rapidapi_translator.py --detect "大周" --env-file .env
```

Rules:

- The shell wins. A variable already exported with a non-empty value is not
  overwritten; an empty one counts as unset and is filled from the file.
- Values are never printed. Startup only reports the *names* it loaded, e.g.
  `[rapidapi] loaded RAPIDAPI_KEY from .env`.
- A path that does not exist is an error (exit 2), not a silent no-op.
- `KEY=VALUE`, `export KEY=VALUE`, quotes and `#` comments are understood; no
  `$VAR` substitution is performed.
- Nothing else in `.env` is disturbed, and `RAPIDAPI_BASE_URL`, `RAPIDAPI_HOST`,
  `RAPIDAPI_CACHE` work there too.

For the MCP server, put the file in the client entry so the key never has to be
exported into the client's shell:

```sh
uv run mcp.py --install-config --client kilo --env-file /root/proofreading/.env
```

That writes the entry with `"--env-file", "/root/proofreading/.env"` and no
`environment` block, i.e. the server reads the file when the client launches it.
For Claude Code and Codex the same flag appends `--env-file …` to the command:

```sh
uv run mcp.py --print-config --client codex --env-file ~/proofreading/.env
```

Optional overrides, mainly for tests:

- `RAPIDAPI_BASE_URL` — base URL (default `https://multi-format-ai-translator-the-most-complete.p.rapidapi.com`)
- `RAPIDAPI_HOST` — value of the `X-RapidAPI-Host` header
- `RAPIDAPI_CACHE` — SQLite cache path (default `content/mtranslate/rapidapi-cache.sqlite3`)

## Which chapter is behind the existing Burmese? (read from the DOCX)

Do not guess an offset. `content/merged/episodes.docx` pairs every Chinese
heading with the Burmese one on the same page, so the numbers come from the file
itself:

```sh
python3 mt/chapter_map.py
```

```
docx: /path/to/repo/content/merged/episodes.docx
Chinese chapters with a Burmese counterpart: 1–193 (193)
Burmese chapters present: 1–195 (195)
split: Chinese 61 → Burmese 61 + 62
split: Chinese 137 → Burmese 138 + 139
last existing Burmese chapter: 195 ↔ Chinese 193
next Chinese chapter without a Burmese counterpart: 194
```

So the chapter behind the *last* existing Burmese chapter (အခန်း ၁၉၅) is
**Chinese 193**, and the next chapter with no human translation is **Chinese
194**. Look one up directly:

```sh
python3 mt/chapter_map.py --at 193            # Chinese 193: Burmese 195
python3 mt/chapter_map.py --at 61             # Chinese 61: Burmese 61, 62
python3 mt/chapter_map.py --burmese 195       # Burmese 195: Chinese 193
python3 mt/chapter_map.py --json              # every pair, machine-readable
python3 mt/chapter_map.py --write content/merged/chapter-map.json
```

The OCR forms in both headings are handled: `第六四意` (64), bare `92`,
`အခန်း (၅)`, `အခန်း(ရ)` (letter ရ for ၇), `အခန်း94` (Arabic digits),
`Chapter 1:`, page repeats, and headings whose page numbers disagree (reported,
not paired).

### Use it from the runner

`--chapters` now accepts words resolved through that map:

```sh
python3 mt/api_translate.py --chapters last --plan   # Chinese 193, has a reference
python3 mt/api_translate.py --chapters next --plan   # Chinese 194, first untranslated
python3 mt/api_translate.py --chapters existing --plan  # all 193 that have one
```

Any run also uses the map for the comparison: Chinese 193 is compared against
Burmese **195**, Chinese 61 against **61 + 62**, and Chinese 62 against Burmese
63. Before this, the comparison assumed Chinese N = Burmese N, which is wrong
after the first split.

Options: `--docx PATH` (default `content/merged/episodes.docx`), `--map PATH`
(use a saved map instead of reading the DOCX), `--no-map` (identity numbering,
stated in the comparison file). The generated files record it too:

```json
"reference": {
  "docx_map": true,
  "span": "Chinese 1–193 ↔ Burmese 1–195; next without one: 194",
  "splits": {"61": [61, 62], "137": [138, 139]}
}
```

The MCP tool `translate_chapters` takes the same selection strings, so an agent
can ask for `"chapters": "next"`.

## Which language comes out?

Every request carries `?source=auto&target=my`. `auto` lets the API detect the
source (it reports what it saw in `source_language` / `source_language_name`),
and `my` is the API's code for Burmese. Nothing is inferred from the text.

```sh
python3 mt/api_translate.py --chapters last --plan
# [rapidapi] language: auto → my (Burmese / Myanmar) (query source=auto&target=my)
```

Change it like any other language pair — the codes are the API's:

```sh
python3 mt/api_translate.py --chapters last --run --target en     # English
python3 mt/api_translate.py --chapters last --run --target th     # Thai
python3 mt/api_translate.py --chapters last --run --source zh-Hant --target my
```

Output files are named after the target (`ch0193.my.txt`, `ch0193.en.txt`), and
the request is recorded in `report.json` as `"target": "my"`.

### Proof that it really came back as Burmese

`status: true` does not prove a translation happened, so after a run the tool
checks the returned text and reports it:

```
[rapidapi] auto → my (Burmese / Myanmar): 1 chapter(s), 191 paragraph(s), 5 request(s)
[rapidapi] 191/191 paragraphs contain Myanmar script
```

and in `report.json`:

```json
"target_check": {"total": 191, "unchanged": 0, "empty": 0, "with_myanmar_script": 191, "warnings": []}
```

Warnings appear on stderr when fewer than half the paragraphs contain Myanmar
script, when more than 20% come back identical to the source, or when a
paragraph is empty. That is the symptom of a wrong target code or an inactive
subscription, not of a bad chapter.

## Agent-in-the-loop: local reasoning, remote MT

The API is a stateless translator. It sees one paragraph, knows nothing about
the story, and cannot keep a name or a tone consistent across a chapter. The
division of labour that works:

| who | does | sees |
|---|---|---|
| RapidAPI | literal MT for a batch of paragraphs | one paragraph at a time |
| your local agent (Kilo) | reads the chapter + the existing human Burmese, picks units, fixes names/tone/style, stores drafts | the whole chapter and the style files |
| you | approve or rewrite | everything |

`mt/agent_work.py` is the missing piece: a place for the agent's text that is
neither machine output nor approved memory.

```sh
python3 mt/agent_work.py read 193 --json        # paragraphs + ids + reference Burmese
python3 mt/agent_work.py save 193 7 --draft "…" --mt "raw api text" --model grok
python3 mt/agent_work.py export 193 --out-dir content/mtranslate/drafts
python3 mt/agent_work.py list --chapter 193
python3 mt/agent_work.py stats
```

- Paragraph ids look like `0193-007-d1f7c063` — chapter, 1-based index, hash of
  the text, so an id cannot silently point at different prose.
- A draft is stored with the machine text it started from, the model that wrote
  it and a note. Status is always `draft`; there is **no approve step here** —
  that stays a human action in `mt/mt_memory.py`.
- Nothing writes into `content/mtranslate/<route>/`, so machine output is never
  overwritten.
- `read` includes the existing human Burmese of the same chapter (from the DOCX
  map, so Chinese 61 brings Burmese 61 + 62) plus a short style card pointing at
  `content/reference/style-sample.txt`, `content/reference/EtoBnames.txt`,
  `content/review/burmese-overview.md` and `MT.md`.

### MCP tools for that loop

`read_chapter`, `save_draft`, `export_drafts` sit next to the translation tools,
so an agent can do the whole thing without shelling out:

```
read_chapter(chapter=193)                      → 191 ids + reference sample + style card
translate_batch(texts=[...], target="my")      → raw MT for the paragraphs it chose
save_draft(chapter=193, paragraph="0193-007-…", draft="…", mt="…", model="grok")
export_drafts(chapter=193)                     → text + zh/machine/draft comparison
```

### Prompt to give the Kilo agent

```
You are translating a Chinese web novel into Burmese, one chapter at a time.
Tools: read_chapter, translate_batch, save_draft, export_drafts.

1. read_chapter(number). Note the paragraph ids and read the existing Burmese
   sample: match its register, honorifics and how names are transliterated.
2. Choose the units to send: keep one source paragraph per batch item, but merge
   fragments that only make sense together. Never send the whole chapter.
3. translate_batch with target "my". Treat the result as raw material.
4. For each paragraph, rewrite the machine text into the house style (LSE for
   prose, LSN inside quotes), keeping names and titles consistent with the
   reference. Then save_draft(chapter, paragraph_id, draft, mt=<machine text>,
   model=<your model>). Do not skip paragraphs you only lightly edited — save
   every one, so the export is complete.
5. export_drafts(chapter) and report: drafted/total, any missing paragraph ids,
   and the three paragraphs you are least sure about, with the Chinese.

Never write to machine output files or to approved memory. If the API returns
text identical to the Chinese or no Myanmar script, stop and say so.
```

The last instruction matters: `translate_batch` reports `requests` and `cached`,
and a run whose output is identical to the source is the symptom of a wrong
`target` or an inactive subscription, not of a difficult paragraph.

## The first two chapters

```sh
# One cheap request first, to prove the key works:
python3 mt/rapidapi_translator.py --detect "大周，帝都盛京。"

# Offline plan: reads the source, counts paragraphs and requests. No key needed.
python3 mt/api_translate.py --chapters 1-2 --plan

# Real run (spends quota):
python3 mt/api_translate.py --chapters 1-2 --run
```

The plan for chapters 1–2 of `content/source/chinese-0511241012-from-8011_1.txt`:

```
chapter  paragraphs  characters  requests
      1          69        1562         2
      2          70        1586         2
  total         139        3148         4
```

Two requests per chapter because a batch is capped at 40 strings. Each chapter
is only ~1,570 characters, so raising the item cap puts one chapter in one
request — two requests for both chapters:

```sh
python3 mt/api_translate.py --chapters 1-2 --run --max-items 80
```

The character budget (4,500) still applies, so a longer chapter can still need
more than one request.

Outputs (`--out-dir`, default `content/mtranslate/rapidapi/`):

| file | content |
|---|---|
| `ch0001.my.jsonl` | one record per paragraph: `source`, `target`, `cached`, chapter, index |
| `ch0001.my.txt` | the chapter in Burmese, paragraphs separated by blank lines |
| `book.my.txt` | every selected chapter |
| `compare-ch001-ch002.md` | Chinese paragraph, new Burmese, and the existing human Burmese as a reference block |
| `report.json` | paragraphs, characters, requests, cache hits, detected language, files |

What is sent is the paragraph text only. Crawler markers, `--- Page N ---`
lines, site promo lines (`活動時間…`), author `PS:` notes, dotted rules and the
`wunzinnosp` watermark are dropped (`--keep-notes` keeps notes and promo lines).
The source file itself is never modified.

The comparison deliberately does **not** claim paragraph alignment with the
human translation: the human text comes from a PDF with its own line wrapping
and the alignment has never been verified. The human chapter is included whole,
under a collapsible block, so you can read the two side by side yourself.

## From a phone over SSH (no desktop app)

Everything here is terminal-only. There are two ways to use it, and the first
one is usually the better fit for a VPS + phone session.

### 1. Just run the script (no MCP at all)

The agent only needs the ability to run a shell command. Nothing to configure:

```sh
export RAPIDAPI_KEY=...          # once per shell
python3 mt/api_translate.py --chapters 1-2 --plan
python3 mt/api_translate.py --chapters 1-2 --run
```

This is the most reliable option over a flaky mobile connection: no background
server to keep alive, output is plain files, and a reconnect changes nothing.

### 2. Register the MCP server with a CLI agent

`uv run mcp.py --serve` is a stdio server, so every CLI agent can launch it.
Pick your client:

```sh
uv run mcp.py --print-config --client claude
uv run mcp.py --print-config --client kilo
uv run mcp.py --print-config --client codex
uv run mcp.py --print-config --client gemini
uv run mcp.py --print-config               # generic JSON
```

**Kilo Code CLI** — global config, `~/.config/kilo/kilo.json` (the same file
accepts `kilo.jsonc`; project scope is `./kilo.json` or `./.kilo/kilo.jsonc`).
Do not paste it by hand if you can avoid it — this writes or merges the entry,
keeps other keys, sets the file to `0600`, and refuses to touch a JSONC file
that contains comments:

```sh
uv run mcp.py --install-config --client kilo
# {"status": "created", "path": "/root/.config/kilo/kilo.json", "entry": {...}}
```

`created`, `merged` or `already` all mean the entry is there; `manual` (exit 1)
means the file is JSONC or not JSON, and the snippet below has to be merged by
hand. `--config PATH` targets another file. The same command works for
`--client gemini` (`~/.gemini/settings.json`).

The resulting block looks like this:

```json
{
  "mcp": {
    "rapidapi-translator": {
      "type": "local",
      "command": ["/usr/bin/python3", "/path/to/repo/mcp.py", "--serve"],
      "enabled": true,
      "environment": {"RAPIDAPI_KEY": "{env:RAPIDAPI_KEY}"}
    }
  }
}
```

`{env:RAPIDAPI_KEY}` is expanded by Kilo at launch, so the key stays in your
shell, not in the config. Export it in the shell that starts `kilo` — a variable
exported in one SSH session is gone after a reconnect:

```sh
read -rsp 'RapidAPI key: ' RAPIDAPI_KEY; echo
export RAPIDAPI_KEY
kilo          # in this same shell, so the variable is inherited
```

To keep it across sessions, add the `export` line to `~/.profile` (that file is
not in this repository). Check with `kilo mcp list`, and toggle servers inside
the TUI with `/mcps`. If a tool call says the key is missing, Kilo did not expand
the variable: either start it from a shell that has it exported, or put the
literal key in `environment` (the config lives outside the repo and is `0600`).

**Claude Code**:

```sh
claude mcp add --scope user rapidapi-translator -- \
  /usr/bin/python3 /path/to/repo/mcp.py --serve
claude mcp list
```

The stdio server inherits the environment of the `claude` process, so export
`RAPIDAPI_KEY` in the shell (or in `~/.profile`) before starting it. `--scope
user` makes it available in every project; omit it for this project only.

**Codex CLI** — `~/.codex/config.toml`:

```toml
[mcp_servers.rapidapi-translator]
command = "/usr/bin/python3"
args = ["/path/to/repo/mcp.py", "--serve"]
env_vars = ["RAPIDAPI_KEY"]
```

`codex mcp add rapidapi-translator -- python3 /path/to/repo/mcp.py --serve`
writes the same table, but it has no flag for forwarding a variable, so add
`env_vars = ["RAPIDAPI_KEY"]` to the table afterwards. (`--env KEY=VALUE` stores
the literal value instead — avoid it on a shared VPS.)

**Gemini CLI** — `~/.gemini/settings.json` (or `gemini mcp add`):

```json
{
  "mcpServers": {
    "rapidapi-translator": {
      "command": "/usr/bin/python3",
      "args": ["/path/to/repo/mcp.py", "--serve"],
      "env": {"RAPIDAPI_KEY": "${RAPIDAPI_KEY}"}
    }
  }
}
```

```sh
gemini mcp add -s user rapidapi-translator /usr/bin/python3 /path/to/repo/mcp.py --serve
```

**Cursor / Zed / other editors** take the generic `mcpServers` JSON from
`--print-config` (Zed uses `context_servers`; same `command`/`args` shape).

Verify before wiring anything up — this needs no key and no network:

```sh
uv run mcp.py --selftest
```

```json
{"ok": true, "protocol": "2025-06-18",
 "tools": ["detect_language", "translate_text", "translate_batch",
           "translate_chapters"],
 "key": "missing", "python": "/usr/bin/python3",
 "server": "/path/to/repo/mcp.py"}
```

If `key` says `missing` but the tools list is fine, the server works and only
the key export is left. If a client shows no tools, run
`--print-config --client <yours>` again and check that the python path exists on
the VPS (`which python3`).

Keep the key out of the repository:

```sh
chmod 600 ~/.profile ~/.config/kilo/kilo.jsonc ~/.codex/config.toml 2>/dev/null
```

Local client configs are already gitignored (`.mcp.json`, `kilo.json`,
`kilo.jsonc`, `.kilo/`), so a project-scoped config cannot be committed with a
key inside. Prefer `export` + `env_vars`/`${VAR}`/`{env:VAR}` over pasting the
literal key anywhere.

Long agent sessions on a phone: run the CLI inside `tmux` (or `screen`) so a
dropped SSH connection does not kill a chapter run. The translator itself is
idempotent — cached paragraphs are not re-requested, so re-running after a
reconnect costs nothing.

## MCP server

```sh
uv run mcp.py --print-config
```

prints a ready-to-paste JSON block:

```json
{
  "mcpServers": {
    "rapidapi-translator": {
      "command": "python3",
      "args": ["/absolute/path/to/repo/mcp.py", "--serve"],
      "env": {"RAPIDAPI_KEY": "<your-rapidapi-key>"}
    }
  }
}
```

Put it in the client's MCP config (Claude Desktop:
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows; Cursor uses
`.cursor/mcp.json`). The key lives in the client config, not in the repository.

Tools:

| tool | arguments | notes |
|---|---|---|
| `detect_language` | `text` | one request |
| `translate_text` | `text`, `target` (default `my`), `source` (default `auto`) | one request unless cached |
| `translate_batch` | `texts[]`, `target`, `source` | only uncached strings are sent |
| `translate_chapters` | `chapters` (`"194&195"`, `"194,195"`, or omitted for the next pair), `target`, `source`, `out_dir` | one pair per call, two chapters at most; calls `mt/apicaller.py` and writes the same files |

Example tool call and result:

```json
{"name": "translate_batch",
 "arguments": {"texts": ["大周，帝都盛京。", "因為他有外掛。"], "target": "my"}}
```

```json
{"translations": ["...", "..."], "source_language": "zh-Hant",
 "source_language_name": "Chinese (Traditional)", "requests": 1, "cached": 0}
```

Protocol notes: newline-delimited JSON-RPC over stdio, `initialize` /
`tools/list` / `tools/call`, protocol versions 2024-10-07 through 2025-06-18.
stdout carries protocol messages only; tool failures come back as `isError`
results, unknown tools as JSON-RPC `-32602`.

The MCP server is local. The RapidAPI-hosted MCP
(`https://mcp.rapidapi.com` through `npx mcp-remote`, the config you pasted)
also works and exposes the same three endpoints, but it cannot read the novel
file, cache paragraphs, or write the comparison — which is why this local one
exists.

## Requests, cache and retries

- One request covers many strings: up to 40 items and 4,500 characters
  (configurable with `--max-items` / `--max-chars`; the documented provider
  limit is 5,000 characters per request).
- A string longer than the budget is split on sentence punctuation and rejoined.
- Successful strings are cached in SQLite by host + language pair + exact text.
  Re-running a chapter, or translating it to a second language, sends only what
  is missing. `--no-cache` disables this.
- 408/425/429/5xx and network errors are retried with exponential backoff,
  honouring `Retry-After`. A retried request may already have been counted by
  RapidAPI; the report shows how many requests were made.
- Redirects are not followed, so the key cannot be forwarded to another host.
- The key is scrubbed from every error message before it is raised.

## What this does not do

- It does not replace the human translation or approve machine output. There is
  no automatic promotion into `mt/mt_memory.py`.
- It does not inject glossary entries; the API has no glossary parameter.
- It does not repair the OCR damage in the Chinese source (the substituted
  characters described in `MT.md`). The API will translate what it is given.
- It does not align the human Burmese to paragraphs, as explained above.

## Tests

The tests use a local mock of the three endpoints, so they need no key and no
network:

```sh
python3 -m unittest discover -s mt/tests -v
```
