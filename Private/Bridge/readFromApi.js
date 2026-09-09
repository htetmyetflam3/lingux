/* ═══════════════════════════════════════════════════════════════
   Module B – File Reader
   Reads:     a resolved file path (provided by Module A)
   Processes: checks existence, streams the file via FSM reader
   Outputs:   full text content back to the caller
   ═══════════════════════════════════════════════════════════════ */

import fs from 'fs';
import { resolvePath } from './path.js';

const CHUNK_SIZE = 256 * 1024;

/* ── FSM read-stream utilities (unchanged) ───────────────────── */

export async function* createFsmReadStream(filePath) {
  const stream = fs.createReadStream(resolvePath(filePath), {
    encoding: 'utf8',
    highWaterMark: CHUNK_SIZE,
  });
  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk;
    const lastNewline = buffer.lastIndexOf('\n');
    if (lastNewline === -1) continue;
    yield buffer.slice(0, lastNewline + 1);
    buffer = buffer.slice(lastNewline + 1);
  }
  if (buffer.length > 0) yield buffer;
}

export async function readAllSegments(filePath) {
  const segments = [];
  for await (const segment of createFsmReadStream(filePath)) {
    segments.push(segment);
  }
  return segments;
}

/* ── Public API for Module A (or any external caller) ────────── */

/**
 * Accept a file path, verify it exists, read it, and return the text.
 * @param {string} filePath
 * @returns {Promise<string>} full file content
 * @throws if the file does not exist
 */
export async function readFileContent(filePath) {
  const resolved = resolvePath(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const segments = await readAllSegments(filePath);
  return segments.join('');
}
