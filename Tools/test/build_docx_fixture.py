#!/usr/bin/env python3
"""Test fixture: build a Zawgyi-encoded .docx from the raw text of test.pdf.

Grabs page 1's RAW (pre-Rabbit) text — exactly what a real-world Burmese
.docx stores — and wraps it in a minimal OOXML container. Used to prove the
server-side docx pipeline converts Zawgyi the same way the PDF path does.

    python3 Tools/test/build_docx_fixture.py Site/Public/PRASER/Python/upload/input/docx/zawgyi_fixture.docx
"""

import os
import sys
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "Site", "Public", "PRASER", "Python", "module"))

from pipeline import stream_pdf_pages  # noqa: E402

PDF = os.path.join(REPO, "Site", "Public", "PRASER", "Python",
                   "upload", "input", "pdf", "test.pdf")

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

XML_TMPL = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    f'<w:document xmlns:w="{W_NS}"><w:body>{{paragraphs}}'
    "<w:sectPr/></w:body></w:document>"
)

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    "</Types>"
)


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def paragraph(text):
    return f'<w:p><w:r><w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>'


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "zawgyi_fixture.docx"

    # Raw page 1 of the test book = Zawgyi code points, pre-conversion.
    _, _, pages = stream_pdf_pages(PDF)
    raw_page1 = next(pages)["text"]
    lines = [ln for ln in raw_page1.split("\n") if ln.strip()]
    assert any("Chapter" in ln for ln in lines), "unexpected page-1 shape"

    # A latin heading + the raw Burmese lines, one paragraph each.
    body = [paragraph("Chapter 701 - Zawgyi fixture")] + [paragraph(ln) for ln in lines]

    doc = XML_TMPL.format(paragraphs="".join(body))
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            "</Relationships>"
        ))
        z.writestr("word/document.xml", doc)
    print(f"[+] fixture written: {out}  ({len(body)} paragraphs, raw Zawgyi)")


if __name__ == "__main__":
    main()
