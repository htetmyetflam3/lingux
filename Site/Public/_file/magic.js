// FILE: _file/magic.js
//
// Magic-byte validation for uploads.
//
// This is the check that neither multer nor mammoth does:
//
//   multer  → parses multipart and enforces size/count limits, but it only
//             ever sees the CLIENT-SUPPLIED filename and mimetype. Both are
//             attacker-controlled; neither says anything about the bytes.
//   mammoth → converts a .docx to text. It is a parser, not a validator: hand
//             it a renamed .exe and you get a stack trace, not a verdict.
//
// So the only way to know a ".pdf" really is a PDF is to read its first bytes.
// The frontend already does exactly this for docx (main.js checks for 0x50 0x4B
// before calling mammoth); this is the same check, server-side, where it counts.

import fs from 'fs/promises';
import path from 'path';

// Longest signature we care about is 8 bytes (OLE2).
const SNIFF_BYTES = 8;

const SIGNATURES = [
  { type: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], label: '%PDF-' },   // %PDF-
  { type: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04], label: 'PK\\x03\\x04' },  // docx (normal)
  { type: 'zip', bytes: [0x50, 0x4b, 0x05, 0x06], label: 'PK\\x05\\x06' },  // empty archive
  { type: 'zip', bytes: [0x50, 0x4b, 0x07, 0x08], label: 'PK\\x07\\x08' },  // spanned archive
  {
    type: 'ole2',
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    label: 'OLE2',
  }, // legacy .doc
];

// What each accepted extension must look like on disk.
// txt has no signature — anything printable is a legitimate .txt.
const EXPECTED = {
  '.pdf': ['pdf'],
  '.docx': ['zip'],
  '.doc': ['ole2', 'zip'], // .doc renamed from .docx is common enough to allow
  '.txt': null, // no signature to check
};

export const ACCEPTED_EXTENSIONS = Object.keys(EXPECTED);

// Hard ceiling on an upload, enforced by multer BEFORE the file is written.
// Mirrors MAX_FILE_SIZE in the frontend (10 MB) — the client cap keeps users
// from wasting an upload, this one is what actually holds.
export const MAX_UPLOAD_BYTES =
  Number.parseInt(process.env.MAX_UPLOAD_BYTES || '', 10) > 0
    ? Number.parseInt(process.env.MAX_UPLOAD_BYTES, 10)
    : 10 * 1024 * 1024;

/** Read the leading bytes of a file and name the format, or 'unknown'. */
export async function sniffFile(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const { buffer, bytesRead } = await handle.read(
      Buffer.alloc(SNIFF_BYTES),
      0,
      SNIFF_BYTES,
      0,
    );
    const head = buffer.subarray(0, bytesRead);
    for (const sig of SIGNATURES) {
      if (head.length < sig.bytes.length) continue;
      if (sig.bytes.every((b, i) => head[i] === b)) return sig.type;
    }
    return 'unknown';
  } finally {
    await handle?.close();
  }
}

/**
 * Verify an upload's bytes agree with its extension.
 *
 * @throws Error with a user-facing message when they disagree.
 * @returns {Promise<{ext: string, detected: string}>}
 */
export async function assertUploadIsValid(filePath, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();

  if (!(ext in EXPECTED)) {
    throw new Error(
      `Unsupported file type: ${ext || '(none)'}. Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}`,
    );
  }

  const stat = await fs.stat(filePath);
  if (stat.size === 0) throw new Error('File is empty');

  const expected = EXPECTED[ext];
  if (expected === null) return { ext, detected: 'text' }; // .txt — nothing to check

  const detected = await sniffFile(filePath);
  if (!expected.includes(detected)) {
    // Say what it actually is when we can — a renamed .doc is the common case.
    const looksLike =
      detected === 'ole2'
        ? ' It looks like a legacy .doc.'
        : detected === 'zip'
          ? ' It looks like a .docx or another zip.'
          : detected === 'pdf'
            ? ' It looks like a PDF.'
            : '';
    throw new Error(
      `File content does not match its .${ext.slice(1)} extension.${looksLike}`,
    );
  }

  return { ext, detected };
}
