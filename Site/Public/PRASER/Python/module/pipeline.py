"""Shared service layer (used by both the CLI and the Flask API).

Orchestrates the full pipeline: load the detector, extract pages from a PDF,
detect/convert encoding per page, compute cleanup candidates + preview changes,
and dispatch final output to the .txt/.docx/.pdf writers in :mod:`render`.

Two execution modes share the same building blocks:

  STREAMING (CLI, large documents):
      ``process_pdf_stream`` walks pages ONE AT A TIME — extract -> detect ->
      convert -> cleanup -> keep only the final text per page. A 7000-page
      book is a single pass; memory stays flat because raw/base/clean copies
      and per-line change lists are never accumulated.

  BATCH (API preview):
      ``process_pdf_bytes`` still builds the full per-page report list with
      inline change previews, because the frontend job store needs them.
"""

import os
import difflib
import math
import tempfile
from pathlib import Path

from paths import find_model_path
from rabbit import Rabbit
from cleanup import cleanup_text
from docx_extract import extract_docx_paragraphs
from pdf_extract import (
    CmapIdentityMap,
    IDENTITY,
    parse_pdf_objects,
    find_font_streams,
    find_tounicode_maps,
    load_sidecar_map,
    pick_embedded_font,
    get_stream,
    parse_ttf_cmap,
    find_root_pages,
    collect_pages,
    extract_page_lines,
    page_has_images,
    get_page_mediabox,
)
from render import _write_docx_layout, _write_pdf

# Pages probed with direct Identity-H decoding before deciding whether the
# document needs the ToUnicode / embedded-font-cmap fallback path.
_DETECT_PROBE_PAGES = 20


def _norm_category(category):
    """Normalize detector categories to the pipeline's uppercase form.

    detector.detect() returns "ZAWGYI"/"UNICODE"/"UNKNOWN"; this also accepts
    lowercase variants ("zawgyi"/"unicode"/"other") from other detector
    generations, mapping "OTHER" to "UNKNOWN".
    """
    cat = str(category).upper()
    return "UNKNOWN" if cat == "OTHER" else cat


def _safe_prob(prob):
    """JSON-safe probability: detector returns -inf for UNKNOWN pages, which
    Flask would serialize as -Infinity (invalid strict JSON for browsers)."""
    return prob if math.isfinite(prob) else 0.0


def _is_myanmar_category(category):
    return _norm_category(category) in ("ZAWGYI", "UNICODE")


def load_detector():
    """Load the Zawgyi detector. Raises RuntimeError if unavailable."""
    try:
        from detector import ZawgyiDetector
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(
            f"Could not import detector.ZawgyiDetector ({e}). "
            "Place detector.py next to this script."
        )

    model_path = find_model_path()
    if not Path(model_path).is_file():
        raise RuntimeError(
            f"Zawgyi model not found (searched: {model_path}). "
            "Expected zawgyiUnicodeModel.dat under module/model/ (or set ZAWGYI_MODEL)."
        )
    return ZawgyiDetector(model_path)


# ═══════════════════════════════════════════════════════════════════════════
#  STREAMING path — one page at a time, flat memory, single pass
# ═══════════════════════════════════════════════════════════════════════════

def stream_pdf_pages(pdf_path, detector=None, log=lambda m: None):
    """Stream per-page layout: returns ``(metadata, npages, iterator)``.

    The iterator yields one dict per page, ONE PAGE AT A TIME:

        {"idx", "text", "lines": [(x, y, size, text)...], "wh": (w, h),
         "has_img": bool}

    ``metadata`` is always ``{}`` — the final pipeline does not scan PDF
    metadata (that full-object regex pass was pure overhead).

    Decoding strategy (model-first, fonts only as a last resort):

    1. When a ``detector`` is supplied, the first ``_DETECT_PROBE_PAGES``
       pages are decoded directly (Identity-H: the content-stream code IS the
       code point) and scored. If any probe page is Myanmar, every page is
       streamed with direct decoding — no font file and no CMap are touched.

    2. Otherwise (subset/custom-encoded fonts, or no Burmese text at all) the
       PDF's ``/ToUnicode`` CMaps (blanked copy-protection decoys skipped)
       plus the cross-volume sidecar map, and if needed the embedded font's
       ``cmap`` table, are built ONCE and then every page is streamed through
       them.
    """
    with open(pdf_path, "rb") as f:
        raw = f.read()
    log(f"[+] PDF size: {len(raw):,} bytes")

    objects = parse_pdf_objects(raw)
    log(f"[+] Objects found: {len(objects)}")
    metadata = {}

    pages_obj = find_root_pages(objects)
    if not pages_obj:
        raise RuntimeError("No page tree found in the PDF.")
    all_pages = collect_pages(objects, pages_obj)
    npages = len(all_pages)
    log(f"[+] Total pages: {npages}")

    def _page(idx, code_to_uni):
        pnum, pgen = all_pages[idx]
        if page_has_images(objects, pnum, pgen):
            # image page (XObject /Image in resources) -> left EMPTY in the
            # output; the DOCX keeps an empty section at the page's size.
            w, h = get_page_mediabox(objects, pnum, pgen)
            return {"idx": idx, "lines": [], "wh": (w, h),
                    "text": "", "has_img": True}
        lines, w, h = extract_page_lines(objects, pnum, pgen, code_to_uni)
        return {
            "idx": idx,
            "lines": lines,
            "wh": (w, h),
            "text": "\n".join(t for _, _, _, t in lines),
            "has_img": False,
        }

    def gen():
        # --- Pass 1: model-first direct (Identity-H) decoding -------------
        if detector is not None:
            probe_n = min(_DETECT_PROBE_PAGES, npages)
            probe = [_page(idx, IDENTITY) for idx in range(probe_n)]
            has_myanmar = any(
                _is_myanmar_category(detector.detect(p["text"])[0]) for p in probe
            )
            if has_myanmar:
                log("[+] Identity-H direct decode — no font/CMap lookup needed")
                for p in probe:
                    yield p
                for idx in range(probe_n, npages):
                    yield _page(idx, IDENTITY)
                    if (idx + 1) % 500 == 0:
                        log(f"    ... extracted {idx + 1}/{npages} pages")
                return
            log("[i] No Myanmar found via direct decode; trying ToUnicode/font cmap")

        # --- Pass 2: truth-first decoding sources --------------------------
        # (a) Embedded font cmap, reversed (the original v1 "peek the font"
        #     method). For these books the font cmap is the GLYPH TRUTH; the
        #     /ToUnicode streams are copy-protection decoys (blanked or with
        #     scrubbed codepoints) and must never win while a cmap decodes.
        # (b) ToUnicode CMaps (+ cross-volume sidecar fill) — fallback for
        #     CFF/OpenType fonts with no usable cmap.
        # Each source is verified with the Markov model on probe pages.
        probe_n2 = min(_DETECT_PROBE_PAGES, npages)

        def _map_decodes_myanmar(m):
            for i in range(probe_n2):
                pnum, pgen = all_pages[i]
                plines, _, _ = extract_page_lines(objects, pnum, pgen, m)
                t = "\n".join(x[3] for x in plines)
                if _is_myanmar_category(detector.detect(t)[0]):
                    return True
            return False

        cmap_map = {}
        conflicts = 0
        font_refs = find_font_streams(objects)
        if font_refs:
            log(f"[+] Embedded font-stream candidates: {len(font_refs)}")
            # Merge the cmap reversal of EVERY embedded font — the book
            # subsets the same base font per page batch, so glyph IDs are
            # shared but each subset's cmap only covers its own glyphs.
            # The Myanmar-glyph font goes first and wins any gid conflict.
            ff_ref, ttf0, cmap0 = pick_embedded_font(objects, font_refs)
            ordered = ([ff_ref] if ff_ref else []) + \
                      [r for r in font_refs if r != ff_ref]
            used = 0
            for ref in ordered:
                if ff_ref and ref == ff_ref:
                    ttf, cmap = ttf0, cmap0
                else:
                    ttf = get_stream(objects, *ref)
                    cmap = parse_ttf_cmap(ttf) if ttf else {}
                if not cmap:
                    continue
                used += 1
                for uni, gid in cmap.items():
                    if not gid:
                        continue
                    if gid in cmap_map:
                        if cmap_map[gid] != uni:
                            conflicts += 1
                        continue
                    cmap_map[gid] = uni
            log(f"[+] Merged font cmap entries: {len(cmap_map)} "
                f"from {used} font stream(s)"
                + (f"; {conflicts} gid conflict(s) (first font wins)"
                   if conflicts else ""))

        tu_map = find_tounicode_maps(objects)
        own_tu = len(tu_map)
        sidecar = load_sidecar_map()
        for code, uni in sidecar.items():
            tu_map.setdefault(code, uni)
        if tu_map:
            log(f"[+] ToUnicode mappings: {own_tu}"
                + (f" (+{len(tu_map) - own_tu} from sidecar cipher map)" if sidecar else ""))

        code_to_uni = None
        if detector is not None:
            if cmap_map and _map_decodes_myanmar(cmap_map):
                # cmap is the glyph truth; CmapIdentityMap adds the two
                # decode truths: 0x0000 = tab/space, unmapped valid code
                # points = exact-Unicode fonts. ToUnicode NEVER fills gaps
                # here — it is the copy-protection decoy.
                code_to_uni = CmapIdentityMap(cmap_map)
                log("[+] Decoding via embedded font cmap (glyph truth) "
                    "+ identity fallback for exact-Unicode fonts")
            elif tu_map and _map_decodes_myanmar(tu_map):
                code_to_uni = tu_map
                log("[+] Decoding via ToUnicode/sidecar map")
        if code_to_uni is None:
            if cmap_map:
                code_to_uni = cmap_map
            elif tu_map:
                code_to_uni = tu_map
            else:
                code_to_uni = {}

        if not code_to_uni:
            log("[!] No font cmap and no ToUnicode map; "
                "unmapped codes will appear as [XXXX] placeholders")

        for idx in range(npages):
            yield _page(idx, code_to_uni)
            if (idx + 1) % 500 == 0:
                log(f"    ... extracted {idx + 1}/{npages} pages")

    return metadata, npages, gen()


def process_pdf_stream(pdf_path, detector, apply_cleanup, log=lambda m: None,
                       want_layout=False):
    """Single-pass streaming pipeline. Returns ``(metadata, npages, iterator)``.

    The iterator yields one dict per page and keeps only ONE page alive at a
    time:

        {"page", "category", "prob", "text", "n_changes",
         "lines", "wh", "has_img"}      # layout fields only when want_layout

    ``text`` is the final text for that page (Zawgyi already converted via
    Rabbit; cleanup applied or not per ``apply_cleanup``); ``n_changes`` is
    how many lines the cleanup step altered (counted, not stored).

    ``want_layout=True`` (DOCX output) additionally carries the per-line
    x/y/font-size and the page MediaBox so the writer can reproduce the page
    exactly; for .txt/.pdf those fields are dropped to keep memory minimal.
    """
    metadata, npages, pages = stream_pdf_pages(pdf_path, detector=detector, log=log)

    def reports():
        for pg in pages:
            idx = pg["idx"]
            raw = pg["text"]
            category, prob = detector.detect(raw)
            cat = _norm_category(category)

            if cat == "ZAWGYI":
                base = Rabbit.zg2uni(raw)
                log(f"    Page {idx + 1}: ZAWGYI (p={prob:.3f}) -> converted")
            elif cat == "UNICODE":
                base = raw
                log(f"    Page {idx + 1}: UNICODE (p={prob:.3f}) -> kept")
            else:
                base = raw
                log(f"    Page {idx + 1}: UNKNOWN -> passed through")
                rep = {"page": idx + 1, "category": cat, "prob": _safe_prob(prob),
                       "text": base, "n_changes": 0}
                if want_layout:
                    rep.update({"lines": _conv_lines(pg["lines"], None, None),
                                "wh": pg["wh"], "has_img": pg["has_img"]})
                yield rep
                continue

            clean = cleanup_text(base)
            n_changes = 0 if clean == base else _count_diff_lines(base, clean)
            text = clean if apply_cleanup else base
            rep = {"page": idx + 1, "category": cat, "prob": _safe_prob(prob),
                   "text": text, "n_changes": n_changes}
            if want_layout:
                rep.update({"lines": _conv_lines(pg["lines"], cat, apply_cleanup),
                            "wh": pg["wh"], "has_img": pg["has_img"]})
            yield rep

    return metadata, npages, reports()


def _convert_line(t, cat, apply_cleanup):
    """Apply the same per-page transform to one extracted line."""
    if cat == "ZAWGYI":
        t = Rabbit.zg2uni(t)
    if cat in ("ZAWGYI", "UNICODE") and apply_cleanup:
        t = cleanup_text(t)
    return t


def _conv_lines(lines, cat, apply_cleanup):
    """Per-line conversion mirroring the page-level transform (layout mode)."""
    return [(x, y, size, _convert_line(t, cat, apply_cleanup))
            for (x, y, size, t) in lines]


def _count_diff_lines(base, clean):
    """Number of lines the cleanup changed (without building change records)."""
    bl = base.split("\n")
    cl = clean.split("\n")
    n = max(len(bl), len(cl))
    return sum(1 for i in range(n)
               if (bl[i] if i < len(bl) else "") != (cl[i] if i < len(cl) else ""))


def collect_stream_results(pdf_path, detector, apply_cleanup, log=lambda m: None,
                           want_layout=False):
    """Convenience: run the streaming pipeline, keep final pages + counts.

    Returns ``(pages, counts, total_changes, metadata)`` where each page is
    ``{"text", "lines"?, "wh"?, "has_img"?}`` ready for :func:`render_texts`.
    """
    metadata, npages, reports = process_pdf_stream(pdf_path, detector,
                                                   apply_cleanup, log=log,
                                                   want_layout=want_layout)
    counts = {"ZAWGYI": 0, "UNICODE": 0, "UNKNOWN": 0}
    pages = []
    total_changes = 0
    for rep in reports:
        counts[rep["category"]] = counts.get(rep["category"], 0) + 1
        pages.append({k: rep[k] for k in ("text", "lines", "wh", "has_img") if k in rep})
        total_changes += rep["n_changes"]
    return pages, counts, total_changes, metadata


# ═══════════════════════════════════════════════════════════════════════════
#  BATCH path — full per-page reports with inline change previews (API)
# ═══════════════════════════════════════════════════════════════════════════

def collect_changes(reports):
    """
    Build the list of lines that the cleanup would change (preview data).
    Line numbers refer to the cleaned/base text of each page.

    Plain text only: ``original`` / ``suggested`` carry the raw lines, no
    server-rendered HTML. Any highlighting is the client's decision.
    """
    changes = []
    for rep in reports:
        if rep["clean"] is None:
            continue
        base_lines = rep["base"].split("\n")
        clean_lines = rep["clean"].split("\n")
        for li in range(max(len(base_lines), len(clean_lines))):
            bl = base_lines[li] if li < len(base_lines) else ""
            cl = clean_lines[li] if li < len(clean_lines) else ""
            if bl != cl:
                changes.append({
                    "id": f"p{rep['page']}-l{li+1}",
                    "page": rep["page"],
                    "line": li + 1,
                    "category": rep["category"],
                    "original": bl,
                    "suggested": cl,
                })
    return changes


def build_content(job, apply_cleanup=False, kind=None):
    """Whole document body as ONE plain text string (API output).

    Every page's final text joined with a blank line — no metadata banner,
    no ``--- Page N ---`` markers, no HTML tags. This is what a caller that
    just wants the text (e.g. the Node backend feeding the grammar engine)
    consumes. ``apply_cleanup=True`` returns the cleaned variant.

    ``kind`` (or ``job['kind']``) picks the join: PDF page texts are joined
    with a blank line (page = block); DOCX page texts are chunked paragraph
    runs and join with a single newline (paragraph = line).
    """
    kind = (kind or job.get("kind") or "pdf").lower()
    sep = "\n" if kind == "docx" else "\n\n"
    parts = []
    for pg, rep in zip(job["pages"], job["reports"]):
        if apply_cleanup and rep.get("clean") is not None:
            parts.append(rep["clean"])
        else:
            parts.append(pg["text"])
    return sep.join(parts)


def build_meta_header(pdf_path, reports, counts, metadata):
    npages = len(reports) if reports is not None else 0
    lines = [
        f"# Source: {pdf_path}",
        f"# Pages: {npages}",
        f"# Detection: {counts.get('ZAWGYI',0)} Zawgyi, "
        f"{counts.get('UNICODE',0)} Unicode, {counts.get('UNKNOWN',0)} unknown",
    ]
    for k, v in (metadata or {}).items():
        lines.append(f"# {k}: {v}")
    lines.append("#" * 50)
    return "\n".join(lines) + "\n\n"


def render_texts(out_path, pages, counts, pdf_path):
    """Write .txt / .docx / .pdf from streamed pages (streaming-friendly).

    ``pages`` is a list of dicts with at least ``"text"``; when they also
    carry ``"lines"``/``"wh"`` (want_layout runs) the DOCX writer reproduces
    the exact PDF page layout (MediaBox size + per-line x/y + font sizes).
    """
    ext = os.path.splitext(out_path)[1].lower()
    if ext == "":
        ext = ".txt"
        out_path += ".txt"

    texts = [p["text"] if isinstance(p, dict) else p for p in pages]
    header = build_meta_header(pdf_path, texts, counts, {})

    if ext == ".txt":
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(header)
            for idx, txt in enumerate(texts):
                f.write(f"--- Page {idx+1} ---\n")
                f.write(txt if txt else "")
                f.write("\n\n")

    elif ext == ".docx":
        _write_docx_layout(out_path, pages, pdf_path)

    elif ext == ".pdf":
        _write_pdf(out_path, texts, {}, pdf_path, len(texts))

    else:
        raise ValueError(f"Unsupported output extension: {ext} (use .txt/.docx/.pdf)")

    return out_path


def process_pdf_bytes(data, detector, filename="upload.pdf", log=lambda m: None):
    """Run the streaming pipeline on raw PDF bytes (API preview job).

    Single pass, layout kept: the job carries per-page reports (base/clean
    for the preview diff) AND the page layout (lines/wh/has_img) so finalize
    can render the exact-layout DOCX. No metadata scan.
    """
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        # apply_cleanup=False here: the apply decision comes at finalize time.
        metadata, npages, reports_iter = process_pdf_stream(
            tmp_path, detector, False, log=log, want_layout=True)
        reports = []
        pages = []
        counts = {"ZAWGYI": 0, "UNICODE": 0, "UNKNOWN": 0}
        for rep in reports_iter:
            cat = rep["category"]
            base = rep["text"]          # converted base (no cleanup yet)
            clean = None if cat == "UNKNOWN" else cleanup_text(base)
            reports.append({"page": rep["page"], "category": cat,
                            "prob": rep["prob"], "base": base, "clean": clean})
            pages.append({"text": base, "lines": rep["lines"], "wh": rep["wh"],
                          "has_img": rep["has_img"]})
            counts[cat] = counts.get(cat, 0) + 1
        changes = collect_changes(reports)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return {
        "filename": filename,
        "kind": "pdf",
        "reports": reports,
        "counts": counts,
        "metadata": {},
        "changes": changes,
        "pages": pages,
    }


# ═══════════════════════════════════════════════════════════════════════════
#  DOCX input — same pipeline, different container
# ═══════════════════════════════════════════════════════════════════════════

# Paragraphs per detection/conversion chunk. The detector is a Markov model
# over Myanmar codepoint sequences: it needs a run of text to be confident,
# but a whole 300-page novel in one string would slow the per-chunk Rabbit
# pass for no gain. 80 paragraphs ≈ one book page — same granularity the PDF
# path detects at.
_DOCX_CHUNK_PARAGRAPHS = 80


def _chunk_paragraphs(paragraphs, per_chunk=_DOCX_CHUNK_PARAGRAPHS):
    """Group paragraphs into detection chunks (list[str] -> list[str])."""
    if not paragraphs:
        return [""]
    return ["\n".join(paragraphs[i:i + per_chunk])
            for i in range(0, len(paragraphs), per_chunk)]


def process_docx_bytes(data, detector, filename="upload.docx", log=lambda m: None):
    """Run the SAME detect -> Rabbit -> cleanup pipeline on raw DOCX bytes.

    The docx container only stores text, so extraction is trivial (see
    :mod:`docx_extract`); the ENCODING work is what the browser could never
    do and the reason .docx is parsed server-side. No layout is kept — DOCX
    finalize supports txt output only.
    """
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        paragraphs = extract_docx_paragraphs(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    reports = []
    pages = []
    counts = {"ZAWGYI": 0, "UNICODE": 0, "UNKNOWN": 0}
    for idx, chunk in enumerate(_chunk_paragraphs(paragraphs)):
        category, prob = detector.detect(chunk)
        cat = _norm_category(category)

        if cat == "ZAWGYI":
            base = Rabbit.zg2uni(chunk)
        else:
            base = chunk  # UNICODE kept, UNKNOWN passed through

        clean = None if cat == "UNKNOWN" else cleanup_text(base)
        reports.append({"page": idx + 1, "category": cat,
                        "prob": _safe_prob(prob), "base": base, "clean": clean})
        pages.append({"text": base})
        counts[cat] = counts.get(cat, 0) + 1

    return {
        "filename": filename,
        "kind": "docx",
        "reports": reports,
        "counts": counts,
        "metadata": {},
        "changes": collect_changes(reports),
        "pages": pages,
    }


def process_bytes(data, kind, detector, filename=None, log=lambda m: None):
    """One entry for both server-side formats: kind = 'pdf' | 'docx'."""
    kind = (kind or "").lower()
    if kind == "pdf":
        return process_pdf_bytes(data, detector,
                                 filename=filename or "upload.pdf", log=log)
    if kind == "docx":
        return process_docx_bytes(data, detector,
                                  filename=filename or "upload.docx", log=log)
    raise ValueError(f"Unsupported kind: {kind!r} (use 'pdf' or 'docx')")


def build_final_pages(job, apply_cleanup):
    """Assemble final render pages from a stored job (API finalize).

    Lines already hold the CONVERTED base text — cleanup is applied per line
    when approved; Rabbit is never re-run (no double conversion).

    DOCX jobs carry no layout (``lines``/``wh``/``has_img`` absent) — those
    pages render txt-only; api.py refuses layout formats for them.
    """
    out = []
    for pg, rep in zip(job["pages"], job["reports"]):
        if "lines" not in pg:
            out.append({"text": rep["clean"]
                        if (apply_cleanup and rep.get("clean") is not None)
                        else pg["text"]})
            continue
        if apply_cleanup and rep["clean"] is not None:
            lines = [(x, y, s, cleanup_text(t)) for (x, y, s, t) in pg["lines"]]
            text = rep["clean"]
        else:
            lines = pg["lines"]
            text = pg["text"]
        out.append({"text": text, "lines": lines,
                    "wh": pg["wh"], "has_img": pg["has_img"]})
    return out
