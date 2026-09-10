/* ═══════════════════════════════════════════════════════════════
   Module-streamline.js (Stream Ingestion & API Reader)
   Reads:     File path or readable stream
   Processes: Streams chunks cleanly on '\n' boundaries (memory.js tiers)
   Outputs:   Async generator yielding line-boundary text blocks
   Replaces:  Bridge/readFromApi.js + monoSyllabism/mapper/context/_readstream.js
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { resolvePath } from './path.js';
import { splitBuffer, getReadChunkSize } from '../monoSyllabism/mapper/context/memory.js';

export const CHUNK_SIZE = 256 * 1024; // 256 KB stream default

/**
 * Async generator: reads a file in ~256 KB chunks, always slicing at '\n'
 * so downstream tokenizers never receive a chopped Burmese character.
 *
 * @param {string} filePath
 * @param {number|null} [highWaterMark=null] - override; null = tier by file bytes
 * @returns {AsyncGenerator<string>}
 */
export async function* createFsmReadStream(filePath, highWaterMark = null) {
  /* Byte sizing lives in memory.js: no explicit size → tier by file
     bytes (64KB–2MB). Pass a number to override. Unstatable path →
     getReadChunkSize falls back to 256KB; the open still throws below
     exactly as before. */
  let knownBytes;
  try {
    knownBytes = fs.statSync(resolvePath(filePath)).size;
  } catch {
    knownBytes = undefined;
  }
  const hwm = highWaterMark ?? getReadChunkSize(knownBytes);
  const resolved = resolvePath(filePath);

  const stream = fs.createReadStream(resolved, {
    encoding: 'utf8',
    highWaterMark: hwm,
  });

  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk;
    const { lines, remainder } = splitBuffer(buffer);
    if (lines !== null) {
      yield lines;
      buffer = remainder;
    }
  }

  if (buffer.length > 0) {
    yield buffer;
  }
}

/**
 * Reads all segments into an array.
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
export async function readAllSegments(filePath) {
  const segments = [];
  for await (const segment of createFsmReadStream(filePath)) {
    segments.push(segment);
  }
  return segments;
}

/**
 * Public API: Accept a file path, verify existence, and return full content.
 * @param {string} filePath
 * @returns {Promise<string>} full file content
 */
export async function readFileContent(filePath) {
  const resolved = resolvePath(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  /* Over 3 MB -> head-chunk only: first 3 MB as partial text, so a big
     file is never loaded whole. Decoder drops a cut tail char. */
  if (fs.statSync(resolved).size > 3 * 1024 * 1024) {
    const fd = fs.openSync(resolved, 'r');
    try {
      const buf = Buffer.alloc(3 * 1024 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      return new StringDecoder('utf8').write(buf.subarray(0, n));
    } finally {
      fs.closeSync(fd);
    }
  }

  const segments = await readAllSegments(filePath);
  return segments.join('');
}
