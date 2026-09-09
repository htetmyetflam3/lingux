"""Low-level PDF parsing and text-layout extraction.

Parses raw PDF bytes into objects/streams, reads embedded font streams
(``/FontFile``, ``/FontFile2``, ``/FontFile3``) and their ``cmap`` tables,
picks the font whose cmap actually contains Myanmar glyphs, reads ``/ToUnicode``
CMap streams (needed for OpenType/CFF and CID fonts that have no ``cmap``),
walks the page tree, and extracts text while preserving layout (line breaks from
text positioning).
"""

import re
import unicodedata
import os
import zlib

# ── decompression-bomb guard ─────────────────────────────────
# The praser is the ONLY component that opens containers, so it is the
# one that carries the cap: a tiny compressed stream must never be able
# to expand into gigabytes inside this process. Env-tunable.
MAX_STREAM_MB = int(os.environ.get("PRASER_MAX_STREAM_MB", "256"))


def zlib_decompress_capped(b, limit_mb=None):
    """zlib.decompress with a hard output cap — bomb-safe."""
    limit = (MAX_STREAM_MB if limit_mb is None else limit_mb) * 1024 * 1024
    out = bytearray()
    dobj = zlib.decompressobj()
    data = b
    while data:
        out += dobj.decompress(data, 1 << 20)
        if len(out) > limit:
            raise ValueError(
                f"decompressed stream exceeds {MAX_STREAM_MB} MB cap "
                "(decompression bomb?)"
            )
        data = dobj.unconsumed_tail
        if dobj.eof:
            break
    out += dobj.flush()
    if len(out) > limit:
        raise ValueError(
            f"decompressed stream exceeds {MAX_STREAM_MB} MB cap "
            "(decompression bomb?)"
        )
    return bytes(out)
import struct


def parse_pdf_objects(raw):
    obj_pat = re.compile(rb'(\d+)\s+(\d+)\s+obj')
    objects = {}
    for m in obj_pat.finditer(raw):
        n, g = int(m.group(1)), int(m.group(2))
        start = m.end()
        end = raw.find(b'endobj', start)
        if end == -1:
            continue
        objects[(n, g)] = raw[start:end].strip()
    return objects


def get_stream(objects, num, gen=0):
    d = objects.get((num, gen), b'')
    i = d.find(b'stream')
    if i == -1:
        return None
    j = i + 6
    if j < len(d) and d[j:j+1] == b'\r':
        j += 1
    if j < len(d) and d[j:j+1] == b'\n':
        j += 1
    k = d.rfind(b'endstream')
    if k == -1:
        return None
    b = d[j:k]
    if b'/FlateDecode' in d[:i]:
        try:
            return zlib_decompress_capped(b)
        except ValueError:
            raise  # bomb guard: refuse the document loudly, never silently
        except Exception:
            return None
    return b


def extract_metadata(objects):
    metadata = {}
    for (n, g), d in objects.items():
        d_str = d.decode('latin-1', errors='replace')
        if re.search(r'/Type\s*/Catalog', d_str):
            info_m = re.search(r'/Info\s+(\d+)\s+\d+\s+R', d_str)
            if info_m:
                info_n = int(info_m.group(1))
                info_d = objects.get((info_n, 0), b'').decode('latin-1', errors='replace')
                for kv in re.finditer(r'/([^\s/\[\]<>()]+)\s*\(([^)]*)\)', info_d):
                    metadata[kv.group(1)] = kv.group(2)
            break
    return metadata


# Matches an embedded font stream reference of any kind:
#   /FontFile    (Type 1)
#   /FontFile2   (TrueType)
#   /FontFile3   (OpenType/CFF, often subtype /OpenType or /CIDFontType0C)
_FONT_STREAM_RE = re.compile(r'/FontFile(?:2|3)?\s+(\d+)\s+(\d+)\s+R')


def find_font_streams(objects):
    """Return a list of all embedded font-stream object refs in the PDF.

    A PDF can embed many fonts (e.g. Zawgyi-One, Calibri, MS Gothic, Times New
    Roman), and they may be stored as ``/FontFile`` (Type 1), ``/FontFile2``
    (TrueType) or ``/FontFile3`` (OpenType/CFF). We collect every candidate so
    the caller can pick the font whose cmap actually contains Myanmar glyphs
    instead of blindly using the first.
    """
    refs = []
    for (n, g), d in objects.items():
        d_str = d.decode('latin-1', errors='replace')
        for m in _FONT_STREAM_RE.finditer(d_str):
            ref = (int(m.group(1)), int(m.group(2)))
            if ref not in refs:
                refs.append(ref)
    return refs


# Backwards-compatible alias (older callers looked for TrueType only).
find_font_files2 = find_font_streams


def _utf16be_to_str(hexstr):
    """Decode a UTF-16BE hex string (e.g. from a ToUnicode CMap) to text."""
    raw = bytes.fromhex(hexstr)
    return raw.decode('utf-16-be', errors='replace')


def parse_tounicode_stream(data):
    """Parse a PDF ``/ToUnicode`` CMap stream into ``{int code: str unicode}``.

    Handles the ``bfchar`` (single mappings) and ``bfrange`` (scalar and array
    ranges) operators used by the common ``CMapType 2`` ToUnicode maps. This is
    the authoritative code→Unicode mapping for CID-keyed fonts (CFF/OpenType),
    which often have no usable ``cmap`` table.
    """
    try:
        text = data.decode('latin-1')
    except Exception:
        return {}

    mapping = {}

    # bfchar: <src> <dst>  (dst is UTF-16BE)
    for m in re.finditer(r'beginbfchar(.*?)endbfchar', text, re.DOTALL):
        for p in re.finditer(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', m.group(1)):
            mapping[int(p.group(1), 16)] = _utf16be_to_str(p.group(2))

    # bfrange, scalar form: <lo> <hi> <start>
    for m in re.finditer(r'beginbfrange(.*?)endbfrange', text, re.DOTALL):
        body = m.group(1)
        for p in re.finditer(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', body):
            lo, hi, start = int(p.group(1), 16), int(p.group(2), 16), int(p.group(3), 16)
            for code in range(lo, hi + 1):
                mapping[code] = chr(start + (code - lo))

    # bfrange, array form: <lo> <hi> [<d1> <d2> ...]
    for m in re.finditer(r'beginbfrange(.*?)endbfrange', text, re.DOTALL):
        body = m.group(1)
        for p in re.finditer(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]', body, re.DOTALL):
            lo, hi = int(p.group(1), 16), int(p.group(2), 16)
            items = re.findall(r'<([0-9A-Fa-f]+)>', p.group(3))
            for i, code in enumerate(range(lo, hi + 1)):
                if i < len(items):
                    mapping[code] = _utf16be_to_str(items[i])

    return mapping


def find_tounicode_maps(objects):
    """Collect every ``/ToUnicode`` CMap in the PDF into ``{code: unicode}``.

    Scans all objects for ``/ToUnicode N G R`` references, decompresses the
    referenced stream, and merges the resulting code→Unicode maps (first
    mapping wins for a given code).

    Copy-protected PDFs ship *blanked* ToUnicode maps (nearly every code maps
    to a space) as decoys. Those are detected (>90% space values) and only
    their non-space entries are kept, so they cannot poison the merge.
    """
    code_to_uni = {}
    seen = set()
    for (n, g), d in objects.items():
        d_str = d.decode('latin-1', errors='replace')
        if '/ToUnicode' not in d_str:
            continue
        for m in re.finditer(r'/ToUnicode\s+(\d+)\s+\d+\s+R', d_str):
            tn = int(m.group(1))
            if tn in seen:
                continue
            seen.add(tn)
            s = get_stream(objects, tn)
            if not s:
                continue
            mp = parse_tounicode_stream(s)
            if not mp:
                continue
            spaces = sum(1 for v in mp.values() if v == ' ')
            if spaces / len(mp) > 0.9:
                # blanked decoy: only its few non-space entries are real
                mp = {k: v for k, v in mp.items() if v != ' '}
            for code, uni in mp.items():
                code_to_uni.setdefault(code, uni)
    return code_to_uni


def load_sidecar_map(path=None):
    """Optional cross-volume cipher map ``module/model/cipher-map.json``.

    Some volumes ship only blanked ToUnicode maps; sibling volumes of the same
    series share the font cipher, so their valid maps (merged once into the
    sidecar JSON as ``{hex_code: unicode}``) can decode them. The document's
    own valid entries always take precedence (caller merges with setdefault).
    """
    import json
    from pathlib import Path
    p = Path(path) if path else Path(__file__).resolve().parent / "model" / "cipher-map.json"
    if not p.is_file():
        return {}
    try:
        return {int(k, 16): v for k, v in json.loads(p.read_text(encoding="utf-8")).items()}
    except Exception:
        return {}


def get_page_mediabox(objects, page_num, page_gen):
    """Return (width, height) of a page's MediaBox in PDF points.

    Walks up the /Parent chain (MediaBox is usually inherited from /Pages).
    Falls back to US Letter (612 x 792).
    """
    d = objects.get((page_num, page_gen), b'')
    for _ in range(8):
        m = re.search(rb'/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]', d)
        if m:
            x0, y0, x1, y1 = (float(v) for v in m.groups())
            return abs(x1 - x0), abs(y1 - y0)
        pm = re.search(rb'/Parent\s+(\d+)\s+(\d+)\s+R', d)
        if not pm:
            break
        d = objects.get((int(pm.group(1)), int(pm.group(2))), b'')
    return 612.0, 792.0


def page_has_images(objects, page_num, page_gen):
    """True when the page's resources declare image XObjects (image pages).

    Resolves the full indirection chain: page -> /Resources (inline or ref)
    -> /XObject dict (inline or ref) -> its entries, which may be inline
    dicts or refs to the image-stream objects carrying /Subtype /Image.
    """
    def _get(ref_match):
        raw = objects.get((int(ref_match.group(1)), 0), b'')
        return raw.decode('latin-1', errors='replace')

    d = objects.get((page_num, page_gen), b'').decode('latin-1', errors='replace')
    res = d
    m = re.search(r'/Resources\s+(\d+)\s+\d+\s+R', d)
    if m:
        res = _get(m)
    if re.search(r'/Subtype\s*/Image', res):
        return True                       # inline image dict in resources
    mx = re.search(r'/XObject\s+(\d+)\s+\d+\s+R', res)
    xo = _get(mx) if mx else res          # XObject dict: indirect or inline
    if re.search(r'/Subtype\s*/Image', xo):
        return True
    for rm in re.finditer(r'(\d+)\s+\d+\s+R', xo):
        if re.search(r'/Subtype\s*/Image', _get(rm)):
            return True                   # image stream behind an entry ref
    return False


_MYA_RANGE = range(0x1000, 0x109F + 1)


def _has_myanmar_glyphs(cmap):
    """True if the cmap maps any Myanmar Unicode codepoint to a glyph."""
    return any(c in _MYA_RANGE for c in cmap)


def pick_embedded_font(objects, refs, log=lambda m: None):
    """Choose the embedded font whose cmap contains Myanmar glyphs.

    Falls back to the first candidate when none contains Myanmar glyphs, and
    returns (ref, ttf_bytes, cmap). ref/ttf/cmap are None/{} when nothing usable
    was found.
    """
    fallback = None
    for ref in refs:
        ttf = get_stream(objects, *ref)
        if not ttf:
            continue
        cmap = parse_ttf_cmap(ttf)
        if _has_myanmar_glyphs(cmap):
            log(f"[+] Chosen embedded font obj {ref[0]} (contains Myanmar glyphs)")
            return ref, ttf, cmap
        if fallback is None:
            fallback = (ref, ttf, cmap)

    if fallback is not None:
        ref, ttf, cmap = fallback
        log(f"[i] No Myanmar-glyph font found; using first font stream obj {ref[0]}")
        return ref, ttf, cmap

    return None, None, {}


def parse_ttf_cmap(data):
    if len(data) < 12:
        return {}
    num_tables = struct.unpack('>H', data[4:6])[0]
    tbls = {}
    off = 12
    for _ in range(num_tables):
        if off + 16 > len(data):
            break
        tag = data[off:off+4].decode('ascii', errors='replace')
        tbl_offset = struct.unpack('>I', data[off+8:off+12])[0]
        tbls[tag] = tbl_offset
        off += 16
    if 'cmap' not in tbls:
        return {}
    cmap_off = tbls['cmap']
    if cmap_off + 4 > len(data):
        return {}
    cmap = data[cmap_off:]
    num_sub = struct.unpack('>H', cmap[2:4])[0]
    mappings = {}
    off = 4
    for _ in range(num_sub):
        if off + 8 > len(cmap):
            break
        plat, enc = struct.unpack('>HH', cmap[off:off+4])
        sub_off = struct.unpack('>I', cmap[off+4:off+8])[0]
        off += 8
        if sub_off + 2 > len(cmap):
            continue
        sub = cmap[sub_off:]
        if len(sub) < 2:
            continue
        fmt = struct.unpack('>H', sub[0:2])[0]
        if fmt == 4:
            if len(sub) < 14:
                continue
            seg_count = struct.unpack('>H', sub[6:8])[0] // 2
            if len(sub) < 14 + seg_count * 8:
                continue
            ends = [struct.unpack('>H', sub[14+i*2:16+i*2])[0] for i in range(seg_count)]
            so = 14 + seg_count * 2 + 2
            starts = [struct.unpack('>H', sub[so+i*2:so+2+i*2])[0] for i in range(seg_count)]
            do = so + seg_count * 2
            deltas = [struct.unpack('>h', sub[do+i*2:do+2+i*2])[0] for i in range(seg_count)]
            ro = do + seg_count * 2
            ranges = [struct.unpack('>H', sub[ro+i*2:ro+2+i*2])[0] for i in range(seg_count)]
            for j in range(seg_count):
                if starts[j] == 0xFFFF:
                    continue
                for c in range(starts[j], ends[j] + 1):
                    if ranges[j] == 0:
                        gid = (c + deltas[j]) & 0xFFFF
                    else:
                        idx = ranges[j] // 2 + (c - starts[j]) + j - seg_count
                        if ro + idx * 2 + 2 > len(sub):
                            continue
                        gid = struct.unpack('>H', sub[ro + idx*2:ro + idx*2 + 2])[0]
                        if gid:
                            gid = (gid + deltas[j]) & 0xFFFF
                    if gid:
                        mappings[c] = gid
        elif fmt == 6:
            if len(sub) < 10:
                continue
            first_code = struct.unpack('>H', sub[6:8])[0]
            entry_count = struct.unpack('>H', sub[8:10])[0]
            for j in range(entry_count):
                if 10 + j * 2 + 2 > len(sub):
                    break
                gid = struct.unpack('>H', sub[10+j*2:12+j*2])[0]
                if gid:
                    mappings[first_code + j] = gid
        elif fmt == 12:
            if len(sub) < 16:
                continue
            num_groups = struct.unpack('>I', sub[12:16])[0]
            go = 16
            for _ in range(num_groups):
                if go + 12 > len(sub):
                    break
                sc, ec, sg = struct.unpack('>III', sub[go:go+12])
                go += 12
                for c in range(sc, ec + 1):
                    mappings[c] = sg + (c - sc)
    return mappings


def collect_pages(objects, page_num, gen=0):
    d = objects.get((page_num, gen), b'')
    d_str = d.decode('latin-1', errors='replace')
    if re.search(r'/Type\s*/Page(?!s)', d_str):
        return [(page_num, gen)]
    if re.search(r'/Type\s*/Pages', d_str):
        pages = []
        km = re.search(rb'/Kids\s*\[(.*?)\]', d, re.DOTALL)
        if km:
            kids_text = km.group(1).decode('latin-1', errors='replace')
            for ref in re.findall(r'(\d+)\s+\d+\s+R', kids_text):
                pages.extend(collect_pages(objects, int(ref)))
        return pages
    return []


def find_root_pages(objects):
    for (n, g), d in objects.items():
        d_str = d.decode('latin-1', errors='replace')
        if re.search(r'/Type\s*/Catalog', d_str):
            pm = re.search(r'/Pages\s+(\d+)\s+\d+\s+R', d_str)
            if pm:
                return int(pm.group(1))
    return None


# Sentinel meaning "the content-stream code IS the Unicode code point".
# Used for Identity-H / direct-encoded fonts (most Burmese PDFs — Zawgyi-One and
# modern Unicode fonts alike). Decoding then needs no font and no CMap.
IDENTITY = object()


class CmapIdentityMap(dict):
    """Font-cmap glyph map with the two decode truths for these books:

    - code 0x0000 is the .notdef glyph = tab/space -> decode as a space;
    - an unmapped code that is a valid code point comes from the few fonts
      that encode with EXACT Unicode code points -> decode as chr(code).

    Every other unmapped code stays a [XXXX] placeholder (real gap).
    """


def _map_code(code_to_uni, cid):
    """Return the Unicode string for a content-stream code, or None if unmapped.

    `code_to_uni` may be:
      - the ``IDENTITY`` sentinel  -> the code is already a code point;
      - a dict of int  -> unicode (from a cmap-derived glyph map); or
      - a dict of int  -> str     (from a ToUnicode CMap, where one code can
        expand to several characters).
    """
    if code_to_uni is IDENTITY:
        if 0 <= cid <= 0x10FFFF and not (0xD800 <= cid <= 0xDFFF):
            return chr(cid)
        return None
    v = code_to_uni.get(cid)
    if v is None:
        if isinstance(code_to_uni, CmapIdentityMap):
            if cid == 0:
                return ' '          # .notdef glyph = tab/space
            if 0x20 <= cid <= 0x10FFFF and not (0xD800 <= cid <= 0xDFFF):
                ch = chr(cid)
                # regex-base validity: only real characters pass — no
                # control, format, surrogate or private-use garbage from
                # stray glyph-ID codes.
                if unicodedata.category(ch)[0] not in 'CC':
                    return ch       # exact-Unicode font, identity decode
        return None
    return chr(v) if isinstance(v, int) else v


def extract_page_lines(objects, page_num, page_gen, code_to_uni):
    """Extract text lines WITH layout: ``(lines, page_w, page_h)``.

    ``lines`` is a top-to-bottom list of ``(x, y, size, text)`` where x/y are
    PDF points (y measured from the page BOTTOM, as in the PDF user space) and
    size is the Tf font size — everything the exact-layout DOCX writer needs
    to reproduce the page. Page size comes from the (inherited) MediaBox.

    `code_to_uni` maps content-stream codes (glyph IDs or CIDs) to Unicode text;
    it is either the ``IDENTITY`` sentinel (direct encoding), a cmap-derived
    glyph map, or a ``/ToUnicode`` CMap — see :func:`_map_code`.
    """
    pd = objects.get((page_num, page_gen), b'')
    pd_str = pd.decode('latin-1', errors='replace')
    streams = []
    cm = re.search(r'/Contents\s+(\d+)\s+\d+\s+R', pd_str)
    if cm:
        streams = [int(cm.group(1))]
    else:
        ca = re.search(r'/Contents\s*\[(.*?)\]', pd_str, re.DOTALL)
        if ca:
            streams = [int(x) for x in re.findall(r'(\d+)\s+\d+\s+R', ca.group(1))]

    pieces = []  # list of (y, x, size, text)

    for sn in streams:
        s = get_stream(objects, sn)
        if not s:
            continue
        content = s.decode('latin-1', errors='replace')

        # Split by BT...ET blocks
        blocks = re.findall(r'BT\s+(.*?)\s+ET', content, re.DOTALL)
        for block in blocks:
            # Find Tm position: a b c d x y Tm
            tm_match = re.search(r'([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+Tm', block)
            if not tm_match:
                continue
            x = float(tm_match.group(5))
            y = float(tm_match.group(6))

            # Active font size for this block (last Tf before the text shows).
            tf_sizes = re.findall(r'/\S+\s+([\d.]+)\s+Tf', block)
            size = float(tf_sizes[-1]) if tf_sizes else 12.0

            block_texts = []

            # TJ arrays: [(text) (text)] TJ or [<hex> <hex>] TJ
            for tj in re.finditer(r'\[(.*?)\]\s*TJ', block):
                arr = tj.group(1)
                i = 0
                arr_text = ""
                while i < len(arr):
                    while i < len(arr) and arr[i] in ' \t\n\r':
                        i += 1
                    if i >= len(arr):
                        break
                    if arr[i] == '<':
                        j = arr.find('>', i)
                        if j == -1:
                            break
                        hex_str = arr[i+1:j]
                        for k in range(0, len(hex_str), 4):
                            cid_hex = hex_str[k:k+4]
                            if len(cid_hex) < 4:
                                continue
                            cid = int(cid_hex, 16)
                            uni = _map_code(code_to_uni, cid)
                            if uni:
                                arr_text += uni
                            else:
                                arr_text += f"[{cid_hex}]"
                        i = j + 1
                    elif arr[i] == '(':
                        depth = 1
                        j = i + 1
                        while j < len(arr) and depth > 0:
                            if arr[j] == '\\' and j + 1 < len(arr):
                                j += 2
                                continue
                            if arr[j] == '(':
                                depth += 1
                            elif arr[j] == ')':
                                depth -= 1
                            j += 1
                        s_text = arr[i+1:j-1]
                        s_text = s_text.replace('\\n', '\n').replace('\\r', '\r').replace('\\t', '\t')
                        s_text = s_text.replace('\\(', '(').replace('\\)', ')').replace('\\\\', '\\')
                        arr_text += s_text
                        i = j
                    elif arr[i] == '-':
                        j = i + 1
                        while j < len(arr) and (arr[j].isdigit() or arr[j] == '.'):
                            j += 1
                        i = j
                    else:
                        j = i
                        while j < len(arr) and (arr[j].isdigit() or arr[j] == '.'):
                            j += 1
                        i = j
                block_texts.append(arr_text)

            # Tj single text
            for tj in re.finditer(r'<([0-9A-Fa-f]+)>\s*Tj', block):
                hex_str = tj.group(1)
                t = ""
                for k in range(0, len(hex_str), 4):
                    cid_hex = hex_str[k:k+4]
                    if len(cid_hex) < 4:
                        continue
                    cid = int(cid_hex, 16)
                    uni = _map_code(code_to_uni, cid)
                    if uni:
                        t += uni
                    else:
                        t += f"[{cid_hex}]"
                block_texts.append(t)

            for tj in re.finditer(r'\((.*?)\)\s*Tj', block):
                s_text = tj.group(1)
                s_text = s_text.replace('\\n', '\n').replace('\\r', '\r').replace('\\t', '\t')
                s_text = s_text.replace('\\(', '(').replace('\\)', ')').replace('\\\\', '\\')
                block_texts.append(s_text)

            if block_texts:
                pieces.append((y, x, size, ''.join(block_texts)))

    page_w, page_h = get_page_mediabox(objects, page_num, page_gen)
    if not pieces:
        return [], page_w, page_h

    pieces.sort(key=lambda p: (-p[0], p[1]))

    lines = []          # (x, y, size, text), top-to-bottom
    current_y = pieces[0][0]
    current_line = []   # (x, size, text)

    def flush():
        # sort key (x, text) — identical to the original layout grouper, so
        # equal-x pieces order exactly as before the coordinates refactor
        ordered = sorted(current_line, key=lambda p: (p[0], p[2]))
        lines.append((ordered[0][0], current_y,
                      max(s for _, s, _ in ordered),
                      ''.join(t for _, _, t in ordered)))

    for y, x, size, text in pieces:
        if abs(y - current_y) > 3:
            flush()
            current_line = []
            current_y = y
        current_line.append((x, size, text))

    if current_line:
        flush()

    return lines, page_w, page_h


def extract_page_text_layout(objects, page_num, page_gen, code_to_uni):
    """Extract text preserving PDF layout (line breaks from text positioning).

    Thin wrapper over :func:`extract_page_lines` returning just the joined
    text (identical output to the original implementation).
    """
    lines, _, _ = extract_page_lines(objects, page_num, page_gen, code_to_uni)
    return '\n'.join(text for _, _, _, text in lines)
