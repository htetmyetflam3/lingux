# MT pilot — superseded for Burmese

> **Status (2026-10-22).** The Chinese → Burmese and English → Burmese legs are
> dropped. No offline zh→my model exists (Argos publishes no Burmese package),
> and the Burmese under review now comes from the translator API, which is far
> better than any pivot MT this file could produce. What remains in use is
> `zh_en`: Chinese → English, so a local agent can read the source and
> cross-check meaning. `mt/translate.py` now exposes only `zh-en` and `en-zh`.
> `init/initmt.py` has been removed with the dropped legs; this file is kept as
> the record of the pilot, not as a plan.

## Exactly three routes

For each selected Chinese source unit, `init/initmt.py` runs:

1. Chinese → Burmese (`zh_my`): the direct candidate.
2. Chinese → English (`zh_en`): the actual intermediate English.
3. That English → Burmese (`en_my`): the pivot candidate.

There are no Chinese back-translation calls. The output keeps all three texts,
chapter metadata, exact Chinese source spans and optional raw provider alignment.
A shared provider may itself use internal pivots: these routes are not claimed
to be independent models, and disagreement/agreement is not an accuracy verdict.
An approved local phrase-memory entry can replace a leg exactly; machine output is
never approved automatically.

Azure Translator v3/general is the configured **baseline candidate**, not a
proven accuracy winner for this novel. Official documentation lists `my`, `en`,
`zh-Hant` and `zh-Hans` text translation and documents this API's request format:

- https://learn.microsoft.com/en-us/azure/ai-services/translator/language-support
- https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/translate

No live authenticated MT call or translation-quality benchmark has been run by
this setup. Paid requests require an explicit `--run` and your locally configured
credentials. The default is an offline plan.

## Run from the repository root

```sh
# No MT API call, key, output file or cache creation:
uv run init/initmt.py --input content/source/chinese-0511241012-from-8011_1.txt --max-units 3 --plan

# After configuring your credentials locally:
uv run init/initmt.py --input content/source/chinese-0511241012-from-8011_1.txt --max-units 3 --run
```

The three-unit uncached plan has an upper bound of **nine requests**. The default
is at most ten units. Whole-input processing requires explicit `--all`.
`uv` may download its declared Python dependency on first use; an offline plan
itself makes no translation request. No third-party Burmese NLP is installed.

## API configuration — guidance only

Use your own Azure Translator resource. Follow its key/region instructions:
https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/authentication

Configure these in your own terminal, not in chat or Git:

- `AZURE_TRANSLATOR_KEY` — your subscription key.
- `AZURE_TRANSLATOR_REGION` — the resource region when required by that resource.
- `AZURE_TRANSLATOR_ENDPOINT` — optional HTTPS base; defaults to
  `https://api.cognitive.microsofttranslator.com`.

For Bash, you can read the key without echoing it or putting its value in a command:

```sh
read -rsp 'Azure Translator key: ' AZURE_TRANSLATOR_KEY; echo
export AZURE_TRANSLATOR_KEY
```

The program only reads environment variables. It does not provision anything,
load/write `.env`, save credentials, or follow HTTP redirects with the key.
Set the region according to your resource rather than guessing one.

## Cache, source protection and output

Default local artifacts under content/mtranslate (runtime stores, regenerated on re-run):

- `content/mtranslate/cache.sqlite3` — successful translations cached independently by
  exact text, language pair, endpoint and API options, never by key.
- `content/mtranslate/chinese-0511241012-from-8011_1-zh-Hant-azure-candidates.jsonl` —
  one record per source unit containing `zh_my`, `zh_en`, `en_my`, each leg's
  `origin`, plus the `memory` review block.
- `content/mtranslate/memory.sqlite3` — approved/pending phrase and glossary entries.

A successful Chinese→English leg is reused as the English→Burmese input; the
pivot does not translate an invented or separately edited English sentence.
Successful legs survive interruption. There is no automatic retry of billable
POSTs: a timed-out request may already have been processed. Final JSONL replaces
an earlier final file only after all selected units finish successfully.

Source text, line endings and Chinese script are preserved. Chapter headers are
metadata, not translated prose. The source limit is measured in UTF-16 units;
recorded source offsets are Python Unicode code points, not provider UTF-16
alignment offsets. No OCR repair or Traditional/Simplified conversion is applied.

## Approved phrase memory (backend only)

`mt/mt_memory.py` is a local SQLite translation memory. There is **no GUI** and no
automatic promotion of machine output. An entry is either `suggested` (draft) or
`approved` (may be reused), and either a normal `phrase` or a glossary `term`.
Entries are route-specific: a Chinese→English entry is not a Chinese→Burmese hit.

```sh
# Draft, then approve explicitly:
uv run mt/mt_memory.py add --source '你們在幹什麼？' --target "YOUR_APPROVED_BURMESE" \
  --from zh-Hant --to my
uv run mt/mt_memory.py approve 1

# A reviewed glossary term (still needs approval to be a glossary hit):
uv run mt/mt_memory.py add --source '葉寧' --target "YOUR_APPROVED_NAME" \
  --from zh-Hant --to my --kind term
uv run mt/mt_memory.py approve 2

uv run mt/mt_memory.py list --status approved
uv run mt/mt_memory.py suggest '你們在幹什麼' --from zh-Hant --to my
uv run mt/mt_memory.py glossary --from zh-Hant --to my
uv run mt/mt_memory.py stats
```

Default store: `content/mtranslate/memory.sqlite3` (runtime store). Export reviewed JSONL
when you want a durable copy; copy a reviewed export somewhere tracked if you want it
versioned. Import validates every line before writing and will not downgrade an
approved entry to `suggested`:

```sh
uv run mt/mt_memory.py export --output content/mtranslate/memory-export.jsonl
uv run mt/mt_memory.py import --input content/mtranslate/memory-export.jsonl
```

Matching normalizes NFKC and whitespace **for lookup only**; the approved text is
stored and reused exactly as entered. Only an approved exact match short-circuits a
billed leg. Similar entries are shown with a similarity score but are never applied.
Approved phrases and glossary terms that occur inside a larger unit are reported as
`direct_phrase_hits` / `glossary_hits`; they are context, not automatic replacement.

`init/initmt.py --run` writes a `memory` block per unit with suggestions, phrase hits and
glossary hits. Every leg records `origin`: `provider`, `provider_cache` or
`translation_memory`. `--suggestions 0` disables similar-phrase suggestions but
keeps phrase/glossary reporting. There is no verified inline glossary parameter in
Azure Translator v3 `translate`, so glossary terms are not silently injected into a
paid request; they remain approved reference data for review and the later AI stage.

Repeated source phrases can be ranked without any Burmese tokenizer. This report
does not create or approve entries:

```sh
uv run mt/mt_memory.py frequent --input content/source/chinese-0511241012-from-8011_1.txt --top 30
```

It splits on Chinese sentence/dialogue punctuation, ignores literal HTML-entity
fragments, and shows a translation only when an approved exact entry already exists.
The source text is not modified.

### Quote repair script

`format/repair_quotes.py` repairs the literal quote entities without changing any other
character. It understands `&quot;`, `&amp;quot;`, `&amp;amp;quot;`, `&#34;` and
`&#x22;`, chooses `“`/`”` from local context, preserves CRLF/BOM/line count, and
can write a TSV audit. `--include-straight-quotes` also normalizes bare `"`;
HCrawler uses the same shared converter while writing, with that option enabled,
so new crawls do not need a later repair pass:

```sh
# Safe default: writes <input>.quotes-repaired.txt
uv run format/repair_quotes.py content/source/chinese-0511241012-from-8011_1.txt \
  --report /tmp/quote-report.tsv

# Explicit in-place rewrite:
uv run format/repair_quotes.py content/source/chinese-0511241012-from-8011_1.txt --in-place
```

The conversion is context-aware rather than a blind alternating replace: it handles
existing `“`/`”`, a closing quote before a narrative tag, a new quote after narrative
ending in `。`, and short nested term pairs. It flags uncertain choices in the report;
it does not repair the substituted characters described below.

The supplied Chinese file **originally** contained 2,824 literal `&quot;` sequences.
The entity repair converted them to **2,486 opening quotes** and **336 closing
quotes**, removed 2 duplicate openings, and flagged 116 conversions for review.
A second explicit pass converted 6 bare `"` closers, so the current file has
**2,486 opening** and **342 closing** quotes, with no entity or ASCII double quotes.
The pre-repair text remains recoverable from commit `61b4b86`.

### Remaining source-quality caveat

The file still contains repeated substituted characters. For example, the recurring
`實不讓教死，教就點無教了` appears 53 times, where the novel's title is
《再不讓我死，我就真無敵了》. The same characters appeared on the sampled
corresponding live page, so this is **not introduced by HCrawler or by this tool**.
The supplied DOCX is a Burmese translation, so it was not used to rewrite the
Chinese. No glyph remapping or OCR cleanup is applied. The corruption affects both
phrase counts and any paid translation; validate or obtain a correct Chinese source
before a full-book MT run.

## Comparison design agreed with the owner

This is the next stage, **not an already implemented grammar resolver**:

1. Dictionary output supplies component lexical tags. A whole compound such as
   `ရေတွင်း` need not be a dictionary entry: `ရေ{n} + တွင်း{n}` can produce a
   compound noun under the supplied compound rule, retaining both children/spans.
2. Build compound candidates before interpreting outer sentence/clause roles.
   Do not mistake flat POS windows for composed words or resolved grammar.
3. Default prose to **LSE (literature style in essay)**. Quoted character speech
   uses **LSN (narration style)**. The owner's examples are `နေကောင်းပါသည်`
   versus `နေကောင်းတယ်၊၊`; style is not inferred from a global particle majority.
4. Use `master.json.top` and `resolution` with sentence style and grammatical
   role to resolve particles. Do not globally replace a surface that has several
   possible roles. Use the supplied rule data for noun/verb/adjective/adverb
   overlap and the grammatical job of composed units; do not mutate raw tags.
5. Only after validated phrase alignment may exposed/differing 1:1 phrases be
   offered to AI, with small context and relevant rules/glossary/tone examples.
   No full-chapter AI call or automatic rewriting is enabled here.

The actual rule data is in `Engine/knowledge/isTreasure/mainrules.js` (JSON),
with the data-only sequence/compound table in root `mainrules.js`. `top` and
`resolution` belong to comparison, not the pass-through POS kernel.

## Optional raw evidence (not grammar resolution)

```sh
uv run mt/mt_compare.py --profile
uv run mt/mt_compare.py --input content/mtranslate/chinese-0511241012-from-8011_1-zh-Hant-azure-candidates.jsonl
```

This audits the supplied catalog and can tag **both** Burmese candidates through
the existing guarded scraper WASM, showing literal differences and lexical
observations. It does not apply the unfinished compound/sentence/style resolver.
The reference audit is `analysis/reference-data-audit.json`; old flat sequence
window counts are not used as grammar decisions. JSON5 reads only the declared
rule-data array; it does not execute JavaScript. The four protected map algorithms
remain WASM-only in production.

Translation, raw annotation and comparison-data identities are separate, so
comparison-rule edits do not cause paid retranslations. POS inputs depend on the
dictionary/map data; `top`/`resolution` remain comparison data. The code verifies
that normalizer tables match the built WASM. AI eligibility stays false and exact
1:1 phrase alignment is explicitly not established.

## Installed dictionaries and engines (2026-10-20)

Two dictionaries and one offline translation model are installed and verified:

```sh
python3 format/fetch_dicts.py --check        # 118,840 CC-CEDICT entries, 21,984 English-Myanmar headwords
python3 mt/fetch_engine.py --check           # zh-en / en-zh offline models only
```

| what | data | where | committed |
|---|---|---|---|
| Chinese → English | CC-CEDICT, 118,840 entries, traditional + simplified | `Engine/knowledge/dicts/cc-cedict.tsv` | no (25 MB, rebuilds) |
| English → Burmese | English-Myanmar dictionary, 21,984 headwords | `Engine/knowledge/dicts/en-my.sqlite` | no (16 MB, rebuilds) |
| Chinese → English MT | Argos/OPUS-MT Marian checkpoint, 83 MB | `$XDG_DATA_HOME/argos-translate/packages` | no |

`format/dicts.py` is the lookup API (`Cedict.lookup`, `Cedict.terms`, `EnMy.lookup`).
The Chinese side accepts both scripts: OpenCC normalises the text and CC-CEDICT
stores a traditional and a simplified form for every entry.

Route availability, measured:

| route | offline model | note |
|---|---|---|
| `zh-en` | **installed** | runs at about 30 sentences/second on CPU |
| `en-my` | none | Argos publishes no Burmese package; GitHub has no `translate-en_my` model |
| `my-en` | none | same |
| `zh-my` | none | same, and the pivot needs `en-my` |

So the Burmese routes are API routes. `mt/translate.py --engine azure` reads
`AZURE_TRANSLATOR_KEY` and `AZURE_TRANSLATOR_REGION` from the environment and
refuses to run without them; nothing is stored in the repository.

`--engine glossary` is a dictionary walk, not MT: it reports how much of a
chapter the two dictionaries can cover (`unresolved` / `tokens` in the report).
On chapter 193 that is 295 unresolved of 786 terms.

## RapidAPI batch route (implemented 2026-10-21)

`mt/rapidapi_translator.py` adds a second API family next to Azure: the RapidAPI
"Multi format AI translator" service, called through `POST /translate/batch`.
`mt/api_translate.py` runs it over the first two chapters and writes
`content/mtranslate/rapidapi/` (JSONL, TXT, a Chinese/Burmese comparison and
`report.json`). `mcp.py` exposes the translator and proofreading tools over MCP stdio.

`mt/chapter_map.py` derives the chapter pairing from `content/merged/episodes.docx`
instead of trusting an offset: it reproduces the verified alignment (Burmese 1..61 =
Chinese 1..61, Chinese 61 → Burmese 61+62, Burmese 63..138 = Chinese 62..137,
Chinese 137 → Burmese 138+139, Burmese 140..195 = Chinese 138..193), including the
OCR heading forms. The comparison therefore references Burmese 195 for Chinese 193.

This is a **comparison candidate**, not a new baseline, and it is not connected
to the approved phrase memory. The key comes from `RAPIDAPI_KEY`; nothing is
stored in the repository. The offline plan and the `--run` gate follow the same
rule as the Azure route: only `--run` spends quota. See `mt/RAPIDAPI.md`.
