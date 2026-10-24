/**
 * mammoth-backed DOCX text extraction — the manager's `method:"default"` path
 * for DOCX input. PDF has no equivalent external reader: `method:"default"`
 * for PDF is PRASER's own recovery decoder (pdf-extract.mjs via pipeline.mjs's
 * processPdfBytes), because it already reads Zawgyi AND Unicode PDFs
 * correctly on its own.
 *
 * This is deliberately a separate path from docx-extract.mjs. The latter reads
 * `document.xml` directly and is what the manager calls for `method:"manual"`
 * (per-page/per-paragraph PRASER decoding) and `method:"null"` (skip images,
 * text only — which docx-extract.mjs already does by construction, since it
 * never looks at drawing/image relationships at all). mammoth is the "same
 * library the browser used" default path: cheap, and correct whenever the
 * document already carries real Unicode Myanmar text instead of a legacy
 * Zawgyi-era font encoding.
 *
 * mammoth.extractRawText() already ignores images — every embedded picture is
 * silently dropped, never turned into a placeholder — so this path only ever
 * returns text, satisfying the "images are not the concern here" contract on
 * its own.
 */
import mammoth from "mammoth";

/** One paragraph per non-empty line; mammoth's raw text separates paragraphs
 * with blank lines, matching docx-extract.mjs's per-paragraph granularity. */
export async function extractDocxParagraphsExternal(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const { value } = await mammoth.extractRawText({ buffer });
  return value
    .split("\n")
    .filter((line) => line.trim().length > 0);
}
