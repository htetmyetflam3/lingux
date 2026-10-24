/**
 * Port of docx_extract.py — DOCX text extraction, standard library only.
 *
 * The Python reads `word/document.xml` with zipfile + ElementTree and walks
 * `root.iter(w:p)`, taking `p.iter()` inside each paragraph. A regex over the raw
 * XML does NOT reproduce that, and the difference is not cosmetic:
 *
 *   - `<w:p/>` (a self-closing empty paragraph) is a paragraph in ElementTree's
 *     view and is KEPT, because empty paragraphs carry the document's spacing.
 *     A `<w:p>…</w:p>` regex drops them, which shifts the 80-paragraph chunk
 *     boundary in pipeline.py — and the chunk is what the detector scores, so a
 *     dropped blank line can flip a chunk from ZAWGYI to UNICODE.
 *   - `p.iter()` also walks `pPr`, so a tab STOP (`<w:pPr><w:tabs><w:tab/>`)
 *     contributes a real "\t". Prefix-matching only the runs would miss it.
 *   - `<w:br w:type="page"/>` is still `{W}br` and becomes "\n" — not only the
 *     bare `<w:br/>`.
 *   - A paragraph nested inside another (text boxes, `mc:AlternateContent`) is
 *     yielded on its own AND as part of the outer one, so its text appears twice.
 *   - Tag matching is by namespace URI + local name, so any prefix works; and
 *     the parser decodes entities and normalises literal CRLF/CR to LF.
 *
 * So this is a small document-order walk with a namespace stack — about the same
 * size as the regex version, but it produces the same list of strings.
 */
import fs from "node:fs";
import { readCentralDirectory, readEntry } from "./zip.mjs";
import { ValueError } from "./pylib.mjs";
import { positiveLimit } from "./resource-limits.mjs";

// A DOCX is a ZIP container. Bound each member, the aggregate declared output,
// and member count before either the custom reader or mammoth sees the archive.
export const MAX_MEMBER_MB = positiveLimit("PRASER_MAX_MEMBER_MB", 64, 256);
export const MAX_DOCX_TOTAL_MB = positiveLimit("PRASER_MAX_DOCX_TOTAL_MB", 128, 512);
export const MAX_DOCX_ENTRIES = positiveLimit("PRASER_MAX_DOCX_ENTRIES", 4096, 20000);
export const MAX_MEMBER_RATIO = 200; // real document.xml compresses ~10-30x; bombs do 1000x

const W_URI = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const DOCUMENT_XML = "word/document.xml";

// word/header1.xml, header2.xml, ... and the footer equivalents.
const HEADER_RE = /^word\/header\d*\.xml$/;
const FOOTER_RE = /^word\/footer\d*\.xml$/;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text) {
  if (!text.includes("&")) return text;
  return text.replace(/&(#\d+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return whole; // invalid ref: left alone
      return String.fromCodePoint(cp);
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}

/**
 * Document-order walk yielding {kind:'open'|'close', uri, local} for elements and
 * {kind:'text', value} for element text content (already entity-decoded and
 * CDATA-merged, like ElementTree's `node.text`).
 */
function* walkXml(xml) {
  const n = xml.length;
  const nsStack = [new Map([["", null]])]; // prefix -> uri; null = "no namespace"
  const scope = [];                        // one Map per open element
  let i = 0;

  const parseName = (raw) => {
    const colon = raw.indexOf(":");
    if (colon === -1) {
      const uri = nsStack[nsStack.length - 1].get("") ?? null;
      return [uri ?? "", raw];
    }
    const prefix = raw.slice(0, colon);
    const local = raw.slice(colon + 1);
    const top = nsStack[nsStack.length - 1];
    const uri = top.has(prefix) ? top.get(prefix) : (prefix === "xml"
      ? "http://www.w3.org/XML/1998/namespace"
      : prefix === "xmlns" ? "http://www.w3.org/2000/xmlns/" : undefined);
    if (uri === undefined) throw new Error(`unbound prefix ${JSON.stringify(prefix)}`);
    return [uri ?? "", local];
  };

  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) break;
    if (lt > i) {
      yield { kind: "text", value: decodeEntities(xml.slice(i, lt)) };
    }
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      const raw = xml.slice(lt + 9, end === -1 ? n : end);
      // CDATA is text content of the enclosing element, like ElementTree's .text
      yield { kind: "text", value: raw, cdata: true };
      i = end === -1 ? n : end + 3;
      continue;
    }
    // find the end of the tag, respecting quoted attribute values
    let j = lt + 1;
    let quote = null;
    while (j < n) {
      const c = xml[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j += 1;
    }
    const tag = xml.slice(lt + 1, j);
    i = j + 1;

    if (tag[0] === "/") {
      // The end tag resolves in the element's OWN scope (its xmlns declarations
      // are in force until the end tag), so resolve before popping.
      const [uri, local] = parseName(tag.slice(1).trim());
      scope.pop();
      nsStack.pop();
      yield { kind: "close", uri, local };
      continue;
    }

    const selfClosing = tag.endsWith("/");
    const body = selfClosing ? tag.slice(0, -1) : tag;
    // split element name from attributes
    let k = 0;
    while (k < body.length && !/[\s]/.test(body[k])) k += 1;
    const rawName = body.slice(0, k);
    const attrText = body.slice(k);

    const attrs = [];
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')|([^\s/>]+)/g;
    let am;
    while ((am = attrRe.exec(attrText)) !== null) {
      const value = am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : null;
      attrs.push([am[1], value === null ? null : decodeEntities(value)]);
    }

    const map = new Map(nsStack[nsStack.length - 1]);
    for (const [aname, value] of attrs) {
      if (aname === "xmlns") map.set("", value ?? "");
      else if (aname.startsWith("xmlns:")) map.set(aname.slice(6), value ?? "");
    }
    nsStack.push(map);
    scope.push({ selfClosing });

    const [uri, local] = parseName(rawName);
    yield { kind: "open", uri, local, selfClosing, attrs };
    if (selfClosing) {
      nsStack.pop();
      scope.pop();
      yield { kind: "close", uri, local };
    }
  }
}

/**
 * extract_docx_paragraphs(): the document's paragraphs as a list of plain strings,
 * in reading order — section headers, then the body (document order, including
 * paragraphs inside tables), then footnotes/endnotes, then section footers — so
 * Burmese text stored outside the body is captured, not dropped.
 */
export function extractDocxParagraphs(docxPath) {
  const buf = Buffer.isBuffer(docxPath) || docxPath instanceof Uint8Array
    ? Buffer.from(docxPath.buffer, docxPath.byteOffset, docxPath.byteLength)
    : fs.readFileSync(docxPath);
  return parseDocxParagraphs(buf);
}

/** Validate the whole package before any third-party or local extractor runs. */
export function validateDocxArchive(zipBuf) {
  const entries = readCentralDirectory(zipBuf);
  if (entries.size > MAX_DOCX_ENTRIES) {
    throw new ValueError(`DOCX exceeds the ${MAX_DOCX_ENTRIES} member cap`);
  }
  if (!entries.has("[Content_Types].xml") || !entries.has(DOCUMENT_XML)) {
    throw new ValueError("ZIP package is not a valid DOCX document");
  }

  let total = 0;
  const memberCap = MAX_MEMBER_MB * 1024 * 1024;
  const totalCap = MAX_DOCX_TOTAL_MB * 1024 * 1024;
  for (const [name, info] of entries) {
    if (
      name.includes('\\') ||
      name.includes('\0') ||
      name.startsWith('/') ||
      name.split('/').includes('..')
    ) {
      throw new ValueError(`DOCX contains an unsafe member name ${JSON.stringify(name)}`);
    }
    if (!Number.isSafeInteger(info.file) || !Number.isSafeInteger(info.compressSize)) {
      throw new ValueError(`DOCX member ${JSON.stringify(name)} has unsafe ZIP64 sizes`);
    }
    if ((info.flags & 0x1) !== 0) {
      throw new ValueError(`DOCX member ${JSON.stringify(name)} is encrypted`);
    }
    if (info.method !== 0 && info.method !== 8) {
      throw new ValueError(`DOCX member ${JSON.stringify(name)} uses unsupported compression`);
    }
    if (info.file > memberCap) {
      throw new ValueError(
        `DOCX member ${JSON.stringify(name)} exceeds the ${MAX_MEMBER_MB} MB cap`,
      );
    }
    const ratio = info.file / Math.max(info.compressSize, 1);
    if (ratio > MAX_MEMBER_RATIO) {
      throw new ValueError(
        `DOCX member ${JSON.stringify(name)} exceeds the ${MAX_MEMBER_RATIO}x compression-ratio cap`,
      );
    }
    total += info.file;
    if (!Number.isSafeInteger(total) || total > totalCap) {
      throw new ValueError(`DOCX exceeds the ${MAX_DOCX_TOTAL_MB} MB expanded-size cap`);
    }
  }
  return entries;
}

/** Read one zip member as normalised XML, refusing decompression bombs. */
function readMemberXml(zipBuf, info, name) {
  const ratio = info.file / Math.max(info.compressSize, 1);
  if (info.file > MAX_MEMBER_MB * 1024 * 1024) {
    throw new ValueError(
      `docx member ${JSON.stringify(name)} exceeds the ${MAX_MEMBER_MB} MB cap (decompression bomb?)`,
    );
  }
  if (ratio > MAX_MEMBER_RATIO) {
    throw new ValueError(
      `docx member ${JSON.stringify(name)} compresses ${info.compressSize} -> ${info.file} bytes `
      + `(ratio ${Math.round(ratio)}x) — decompression bomb, refused`,
    );
  }
  const xmlBytes = readEntry(zipBuf, info, { maxOutputBytes: (MAX_MEMBER_MB + 1) * 1024 * 1024 });
  // XML line-end normalisation happens in the parser, before entities are decoded.
  return xmlBytes.toString("utf8").replace(/\r\n?/g, "\n");
}

/** Text-bearing members in reading order: headers, body, notes, footers. */
function orderedParts(names) {
  const ordered = [];
  ordered.push(...names.filter((n) => HEADER_RE.test(n)).sort());
  if (names.includes(DOCUMENT_XML)) ordered.push(DOCUMENT_XML);
  for (const n of ["word/footnotes.xml", "word/endnotes.xml"]) {
    if (names.includes(n)) ordered.push(n);
  }
  ordered.push(...names.filter((n) => FOOTER_RE.test(n)).sort());
  return ordered;
}

export function parseDocxParagraphs(zipBuf) {
  const entries = validateDocxArchive(zipBuf);
  const paragraphs = [];
  for (const name of orderedParts([...entries.keys()])) {
    const info = entries.get(name);
    if (!info) continue;
    paragraphs.push(...collectParagraphs(readMemberXml(zipBuf, info, name)));
  }
  return paragraphs;
}

/** The ElementTree-equivalent part: paragraphs, each the join of its w:t / w:br /
 *  w:tab descendants — accumulated for EVERY open w:p so a nested paragraph
 *  contributes to both itself and its ancestor, exactly like root.iter(). */
export function collectParagraphs(xml) {
  const paragraphs = [];
  const openParagraphs = []; // one accumulator per open w:p, innermost last
  const elStack = [];        // open elements, to know a text node's parent

  for (const ev of walkXml(xml)) {
    if (ev.kind === "open") {
      elStack.push({ uri: ev.uri, local: ev.local, textTaken: false });
      if (ev.uri === W_URI && ev.local === "p") {
        // root.iter() yields in DOCUMENT order, so an outer paragraph comes
        // before a paragraph nested inside it: claim the output slot at OPEN
        // time and fill it when the element closes.
        const ctx = { parts: [], at: paragraphs.length };
        paragraphs.push("");
        openParagraphs.push(ctx);
      }
      if (openParagraphs.length) {
        if (ev.uri === W_URI && ev.local === "br") {
          for (const ctx of openParagraphs) ctx.parts.push("\n");
        } else if (ev.uri === W_URI && ev.local === "tab") {
          for (const ctx of openParagraphs) ctx.parts.push("\t");
        }
      }
    } else if (ev.kind === "text") {
      // ElementTree's `node.text` is the text before the element's first child,
      // and only for the element we care about — <w:t>. Anything elsewhere
      // (whitespace between tags, w:instrText, w:delText) is ignored, as in Python.
      const top = elStack[elStack.length - 1];
      if (top && !top.textTaken && top.uri === W_URI && top.local === "t" && openParagraphs.length) {
        top.textTaken = true;
        for (const ctx of openParagraphs) ctx.parts.push(ev.value);
      }
    } else if (ev.kind === "close") {
      elStack.pop();
      if (ev.uri === W_URI && ev.local === "p") {
        const ctx = openParagraphs.pop();
        if (ctx) paragraphs[ctx.at] = ctx.parts.join("");
      }
    }
  }
  return paragraphs;
}
