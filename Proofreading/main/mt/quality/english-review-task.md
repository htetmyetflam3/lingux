# Local English review task

Use this task when the assignment is to proofread the **English chapters already
translated by the API**. This is separate from the Burmese finetuning task in
`finetune-agent-prompt.md`.

Do not call the API, retranslate chapters, or read the whole book. The tracked
API output is only `content/mtranslate/english.txt`; API-generated Burmese text
and other per-chapter API text have been removed. Compare a small window against
the Chinese and local machine English, then return only English lines that need
revision.

## 1. Compare one chapter window

Call the read-only tool with the **current Chinese chapter number**:

```text
compare_english_chapter {"chapter": 194, "start": 1, "count": 10}
```

Each returned `lines` row is one source paragraph and contains:

- `zh` — the original Chinese paragraph;
- `machine_en` — the local `zh-en` machine translation, grouped back to that
  source paragraph from its sentence-level output;
- `api_en` — the RapidAPI English for the same paragraph;
- `id` and `index` — stable chapter/paragraph reference.

Read `alignment` before judging. API JSONL source text is verified exactly; the
single-file API output is checked by chapter and paragraph count. The local MT
sentence counts are checked against the source before sentences are grouped. If
a tool reports an alignment error, **stop**; do not guess or shift rows.

The default is ten paragraphs. Continue with `window.next_start`; do not ask for
a whole chapter in one call. The only tracked English translation inputs are:

- API English: `content/mtranslate/english.txt`;
- local zh-en machine English: `content/mtranslate/zh-en.txt`.

If the API file does not contain the requested chapter, or either file is
missing, stop and tell the human which input is unavailable. Do not substitute
or recreate deleted API output. The comparison tool is read-only and never
creates or rewrites either translation.

## 2. Look up a Burmese term from the prior chapters

Before finalizing any recurring name, title, place, or technical term whose
established English is unclear, consult the human Burmese from the preceding
chapters. Query it using a **Burmese-script keyword** and the current Chinese
chapter number; this context check is required when such a prior rendering may
exist:

```text
previous_burmese_context {"chapter": 194, "keyword": "နတ်"}
```

The required `chapter` tells the tool where to look: it searches the two
preceding **Chinese** chapters and uses the merged DOCX chapter map to find their
Burmese counterparts. For Chinese chapter 194, those are Chinese 192 and 193,
which map to Burmese 194 and 195. It returns only a few complete Burmese lines
around each exact keyword hit. Set `before` and `after` to change the context
window, or `max_hits` to cap the results.

Use the human Burmese excerpt when checking recurring terms or established
renderings, but account for known encoding damage in the source (Zawgyi-order
clusters, substitutions, and dropped vowels). Treat it as a contextual clue,
not a reliable spelling or grammar baseline; verify meaning and any proposed
English against the Chinese. If corrupted text prevents an exact keyword hit,
do not guess or copy a form from it. If the keyword is not in Burmese script,
the tool refuses it rather than doing a broad search.

## 3. Review and report

For each line, compare the API English with the Chinese. Use `machine_en` as a
second witness, not as an unquestioned answer. Keep API English when it is
already accurate and readable. When it is not, report the paragraph index and
ID, the proposed English, and a brief reason grounded in the Chinese or a
specific prior-Burmese context hit.

Suggested response format:

```text
Chapter 194 — paragraphs 1–10
- 0194-003-<id>: change “<API wording>” to “<revised English>” — the Chinese says …
- 0194-007-<id>: keep — API and local MT preserve the same meaning.
```

Do not copy the whole tool result back. Do not modify `english.txt`, the API
chapter files, or the machine MT files. Return only corrections and material
ambiguities; if a window needs no changes, say so and give the next window
number.
