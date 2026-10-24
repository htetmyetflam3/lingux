# Paste this as the Arena agent's task entry

You are the local English-review agent for this novel. Your task is to review and
improve the **existing English translated by the API**, using the Chinese
original and the local machine-English translation as witnesses. This is a
proofreading/revision task, not a request to call a translator API.

## Hard limits

- **Do not call any API.** In particular, never call `translate_text`,
  `translate_batch`, `translate_chapters`, or run `api_translate.py --run`.
  No retries, test calls, or “just one sample” requests; API generation is a
  separate, human-run workflow.
- Do not read the million-character source or whole-book English file directly.
  Use the chapter tools, which return bounded, aligned excerpts.
- Do not alter or overwrite `english.txt`, RapidAPI output, or local machine
  translation files. The API English is the draft to review, not an output file
  to edit in place.
- Do not start revising until you have completed the study/check phase below
  and the user has answered your checkpoint.

## Phase 1 — study and verify, but do not translate yet

Read these task documents first:

1. `mt/quality/START.md`
2. `mt/quality/english-review-task.md`
3. `mt/quality/finetune-agent-prompt.md` (use only its relevant guidance on
   names, source authority, and Burmese-reference limitations)
4. `tools/README.md`
5. The `mcp.py` section of `mt/SETUP.md`

Then inspect file availability using the tools or file metadata—not by opening
large text files directly. Unless the user gives another pair, the first and
only chapters for the trial are **Chinese chapters 194 and 195**. Confirm that
for both chapters you can access:

- API English: `content/mtranslate/english.txt` only;
- local machine English: `content/mtranslate/zh-en.txt` only;
- prior human Burmese context, when a recurring term needs historical evidence,
  via `previous_burmese_context` (encoding-damaged; clues only).
- Chinese source, already used by `compare_english_chapter`.

If an input is missing or the comparison tool reports an alignment error, do
not improvise or silently proceed with only two columns. Report exactly which
file/input is missing and ask the user how they want to proceed.

After studying and checking, provide a short understanding check: state the
purpose of the three columns, the two chapters you will review, that no API
calls will be made, and any missing inputs or uncertainties. Then ask:

> Do you have any corrections or questions before I begin reviewing chapters
> 194 and 195? I will wait for your answer before making any revisions.

**Stop here and wait.** Do not begin translating, revising, or generating the
chapter text in the same turn as this question. If you have no confusion, say
that plainly, but still wait for the user's reply/authorization.

## Phase 2 — only after the user answers

Review **chapters 194 and 195 only**. Do not continue to chapter 196. Use
`compare_english_chapter` in ten-paragraph windows, following `window.next_start`:

```text
compare_english_chapter {"chapter": 194, "start": 1, "count": 10}
compare_english_chapter {"chapter": 195, "start": 1, "count": 10}
```

Each row supplies the original Chinese (`zh`), local machine English
(`machine_en`), and existing API English (`api_en`). Check the tool's alignment
metadata. If it refuses alignment, stop and ask—never shift paragraphs by eye.

When an English term needs precedent, use the exact Burmese-script keyword and
include the **current Chinese chapter**. This is required so the tool can map
the two preceding Chinese chapters to their Burmese counterparts:

```text
previous_burmese_context {"chapter": 194, "keyword": "နတ်"}
```

For the command-line entry point, the equivalent is:

```sh
uv run mcp.py --compare_english_chapter 194 --start 1 --count 10
uv run mcp.py --previous_burmese_context "နတ်" --chapter 194
```

The Burmese excerpt is terminology/context evidence only. The human Burmese
source has known encoding damage (Zawgyi-order clusters, substitutions, dropped
vowels); do not treat its spelling or grammar as authoritative, and do not copy
corrupted forms. Chinese controls meaning; local machine English is a second
witness, not an authority. Keep accurate API English unchanged. Revise only
actual meaning, omission, grammar, readability, or consistency defects. Do not
translate from Burmese or mistake OCR/PDF damage for source truth.

## Output and stop

After explicit authorization, return revised English for chapters 194 and 195
only, preserving source paragraph order and chapter headings. Mark each change
with its paragraph index and give a brief reason tied to the Chinese or to a
specific comparison/context result. If the user has not specified where to save
the final text, provide it in the response and do not write over any source or
API output file. After these two chapters, stop and wait for review; do not
continue the novel unless the user asks.
