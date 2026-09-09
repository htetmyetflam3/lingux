"""DOCX text extraction — pure standard library (zipfile + ElementTree).

The browser cannot do this job: mammoth.js hands back the raw stored code
points, which for Burmese documents are Zawgyi/imposter-encoded exactly like
the PDF case. The extraction itself is trivial; the ENCODING work (detect ->
Rabbit convert -> cleanup) happens downstream in the same pipeline the PDFs
go through, which is the whole reason .docx uploads are parsed server-side.

Only ``word/document.xml`` is read — body paragraphs in document order,
including paragraphs inside tables. Headers/footers/footnotes are ignored.
"""

import zipfile
import xml.etree.ElementTree as ET

# wordprocessingml namespace: every content tag in document.xml is namespaced.
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

DOCUMENT_XML = "word/document.xml"


def extract_docx_paragraphs(docx_path):
    """Return the document's paragraphs as a list of plain strings.

    Within a paragraph, ``<w:t>`` runs are concatenated in order; ``<w:br/>``
    becomes a newline and ``<w:tab/>`` a tab. Empty paragraphs are kept —
    they carry the document's spacing.
    """
    with zipfile.ZipFile(docx_path) as z:
        xml_bytes = z.read(DOCUMENT_XML)
    root = ET.fromstring(xml_bytes)

    paragraphs = []
    for p in root.iter(f"{W}p"):
        parts = []
        for node in p.iter():
            if node.tag == f"{W}t":
                parts.append(node.text or "")
            elif node.tag == f"{W}br":
                parts.append("\n")
            elif node.tag == f"{W}tab":
                parts.append("\t")
        paragraphs.append("".join(parts))
    return paragraphs
