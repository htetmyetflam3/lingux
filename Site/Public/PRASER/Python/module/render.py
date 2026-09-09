"""Output writers for .txt / .docx / .pdf.

DOCX output is the EXACT-LAYOUT writer: one DOCX section per PDF page with
the page's MediaBox size and every line placed at its PDF x/y with its Tf
font size. Fonts: Anonymous Pro (Latin) + YoeYar-One (Burmese) only.
"""

from fonts import (
    ANONYMOUS_PRO_FILES,
    FONT_ROLES,
    _apply_pdf_role,
    _docx_family,
    _register_pdf_fonts,
    classify_text_role,
)
from paths import ANONYMOUS_PRO_DIR


def _esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def _pdf_line_height(pdf, role):
    """Line height (document units) for the currently-active font of a role."""
    cfg = FONT_ROLES[role]
    return pdf.font_size_pt * cfg["line_spacing"] / pdf.k


def _write_pdf(out_path, texts, metadata, pdf_path, npages):
    try:
        from fpdf import FPDF
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"PDF output needs the fpdf package (pip install fpdf). {e}")

    eng_reg = ANONYMOUS_PRO_FILES.get("")
    if eng_reg is None or not eng_reg.is_file():
        raise RuntimeError(
            f"Anonymous Pro font not found in {ANONYMOUS_PRO_DIR} "
            "(required for PDF output)."
        )

    class _PageNumPDF(FPDF):
        def footer(self):
            # Page number in its own role/font, centered at the bottom.
            self.set_y(-15)
            _apply_pdf_role(self, "page_number")
            self.cell(0, _pdf_line_height(self, "page_number"),
                      str(self.page_no()), align="C")

    pdf = _PageNumPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    _register_pdf_fonts(pdf)

    left, top = 18, 18

    def render_header():
        pdf.set_xy(left, top)
        _apply_pdf_role(pdf, "title")
        pdf.cell(0, _pdf_line_height(pdf, "title"), f"Source: {pdf_path}",
                 new_x="LMARGIN", new_y="NEXT")
        _apply_pdf_role(pdf, "meta")
        meta_items = [("Pages", npages)] + list((metadata or {}).items())
        for k, v in meta_items:
            pdf.cell(0, _pdf_line_height(pdf, "meta"), f"{k}: {v}",
                     new_x="LMARGIN", new_y="NEXT")
        pdf.ln(5)

    for idx, txt in enumerate(texts):
        pdf.add_page()
        pdf.set_xy(left, top)
        if idx == 0:
            render_header()
            pdf.ln(3)

        prev_blank = True
        for line in (txt or "").split("\n"):
            role = classify_text_role(line, prev_blank)
            if role == "blank":
                pdf.ln(_pdf_line_height(pdf, "paragraph") * 0.5)
                prev_blank = True
                continue
            _apply_pdf_role(pdf, role)
            pdf.cell(0, _pdf_line_height(pdf, role), line,
                     new_x="LMARGIN", new_y="NEXT",
                     align=FONT_ROLES[role]["align"])
            prev_blank = False

    pdf.output(out_path)



# ═══════════════════════════════════════════════════════════════════════════
#  EXACT-LAYOUT DOCX — 1 PDF page = 1 DOCX page, same size, same positions
# ═══════════════════════════════════════════════════════════════════════════
#
# Each PDF page becomes its own DOCX section whose w:pgSz equals the page's
# MediaBox (twips = pt * 20, margins zeroed), and every extracted line is
# placed at its PDF coordinates: x -> w:ind w:left, y (converted from the
# PDF bottom-up user space to top-down) -> cumulative w:spacing w:before
# with exact line heights. Fonts: Myanmar runs get YoeYar-One (cs), Latin
# runs Anonymous Pro, size from the content stream's Tf.

_TWIPS = 20          # twips per point
_LH = 1.2            # line-height factor for exact line rules


def _has_myanmar(text):
    return any(0x1000 <= ord(c) <= 0x109F for c in text)


def _layout_para(x_tw, before_tw, size, text):
    half = max(1, round(size * 2))
    line_tw = max(1, round(size * _LH * _TWIPS))
    bm = "YoeYar-One" if _has_myanmar(text) else "Anonymous Pro"
    rpr = (f'<w:rPr><w:rFonts w:ascii="Anonymous Pro" w:hAnsi="Anonymous Pro" '
           f'w:cs="{bm}"/><w:sz w:val="{half}"/><w:szCs w:val="{half}"/></w:rPr>')
    ppr = (f'<w:pPr><w:spacing w:before="{max(0, round(before_tw))}" w:after="0" '
           f'w:line="{line_tw}" w:lineRule="exact"/>'
           f'<w:ind w:left="{max(0, round(x_tw))}" w:right="0" w:firstLine="0"/>'
           f'<w:jc w:val="left"/></w:pPr>')
    return f'<w:p>{ppr}<w:r>{rpr}<w:t xml:space="preserve">{_esc(text)}</w:t></w:r></w:p>'


def _sect_pr(w_pt, h_pt):
    return (f'<w:sectPr><w:pgSz w:w="{round(w_pt * _TWIPS)}" w:h="{round(h_pt * _TWIPS)}"/>'
            f'<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" '
            f'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')


def _write_docx_layout(out_path, pages, pdf_path):
    """DOCX replica of the PDF: identical page sizes and text positions.

    Streams document.xml into the zip page-by-page — memory stays constant
    no matter how many pages the book has.
    """
    import zipfile
    n = len(pages)
    head = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>')

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '</Types>')
        zf.writestr('_rels/.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
        with zf.open('word/document.xml', 'w') as doc:
            doc.write(head.encode('utf-8'))
            for i, pg in enumerate(pages):
                chunk = []
                w_pt, h_pt = pg.get("wh") or (612.0, 792.0)
                lines = pg.get("lines") or []
                if not lines and pg.get("has_img"):
                    chunk.append(_layout_para(20 * _TWIPS, 20 * _TWIPS, 10, "[image-only page]"))
                prev_base = None
                prev_h = 0.0
                for (x, y, size, text) in lines:
                    if not text:
                        continue
                    base_top = h_pt - y           # baseline, measured from page top
                    if prev_base is None:
                        before = max(0.0, base_top - size)
                    else:
                        before = max(0.0, base_top - prev_base - prev_h)
                    prev_base, prev_h = base_top, size * _LH
                    chunk.append(_layout_para(x * _TWIPS, before * _TWIPS, size, text))
                if i < n - 1:
                    chunk.append(f'<w:p><w:pPr>{_sect_pr(w_pt, h_pt)}</w:pPr></w:p>')
                else:
                    chunk.append(_sect_pr(w_pt, h_pt))
                doc.write("".join(chunk).encode('utf-8'))
            if n == 0:
                doc.write(_sect_pr(612.0, 792.0).encode('utf-8'))
            doc.write(b'</w:body></w:document>')


# ═══════════════════════════════════════════════════════════════════════════
#  Plain DOCX writer — text in, simple paragraphs out (no PDF layout)
# ═══════════════════════════════════════════════════════════════════════════

def write_docx_plain(out_path, text):
    """Write ``text`` as a plain DOCX: one paragraph per line.

    The result-rewrite path (Engine output -> .docx) has no PDF layout to
    reproduce — no per-line x/y or font sizes — so unlike _write_docx_layout
    this makes NO claim of being a page replica. Streams in chunks so a
    whole-book result stays constant-memory.
    """
    import zipfile

    head = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/'
            'wordprocessingml/2006/main"><w:body>')

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '</Types>')
        zf.writestr('_rels/.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
        with zf.open('word/document.xml', 'w') as doc:
            doc.write(head.encode('utf-8'))
            lines = (text or '').split('\n')
            step = 2000  # paragraphs per zip write — constant memory
            for i in range(0, len(lines), step):
                chunk = []
                for line in lines[i:i + step]:
                    if line:
                        chunk.append(_layout_para(0.0, 0.0, 11.0, line))
                    else:
                        chunk.append('<w:p/>')
                doc.write(''.join(chunk).encode('utf-8'))
            doc.write(_sect_pr(612.0, 792.0).encode('utf-8'))
            doc.write(b'</w:body></w:document>')
    return out_path
