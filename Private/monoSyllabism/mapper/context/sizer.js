/* ═══════════════════════════════════════════════════════════════
   Module-sizer.js (Memory Throttling & Sizing Utilities)
   - Dynamic line-batch sizing for downstream taggers/rule engines
   - Multi-byte safe buffer splitting on '\n'
   - Calculates optimal I/O chunk sizes
   Replaces: monoSyllabism/mapper/context/_file.js
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import { resolvePath } from '../../../Bridge/path.js';

/**
 * Splits a string buffer at its last newline.
 * Prevents slicing multi-byte Burmese characters or words mid-glyph.
 *
 * @param {string} buffer
 * @returns {{ lines: string|null, remainder: string }}
 */
export function splitBuffer(buffer) {
  const lastNewline = buffer.lastIndexOf('\n');
  if (lastNewline === -1) {
    return { lines: null, remainder: buffer };
  }
  return {
    lines: buffer.slice(0, lastNewline + 1),
    remainder: buffer.slice(lastNewline + 1),
  };
}

/**
 * Calculate optimal line-batch size for downstream tagger/rule engine.
 * Accepts either a file path string or a raw byte count (from API headers).
 *
 * Sane Burmese line density tiers:
 *   - < 20 KB (queries, short text): Infinity (1-pass in RAM)
 *   - 20 KB - 2 MB (~30k lines):    1,000 lines/batch (~25 clean batches)
 *   - 2 MB - 10 MB:                 2,500 lines/batch
 *   - > 10 MB:                      5,000 lines/batch
 *
 * @param {string|number|null} source - File path or known byte size
 * @returns {number} batch line count
 */
export function getBatchSize(source) {
  let sizeMB = null;

  if (typeof source === 'number') {
    sizeMB = source / (1024 * 1024);
  } else if (typeof source === 'string') {
    try {
      const stats = fs.statSync(resolvePath(source));
      sizeMB = stats.size / (1024 * 1024);
    } catch {
      sizeMB = null;
    }
  }

  if (sizeMB === null) return 1000;   // Fallback for unknown streams / pipes
  if (sizeMB < 0.02)  return Infinity; // < 20 KB: instant single pass in RAM
  if (sizeMB < 2)     return 1000;     // 20 KB - 2 MB
  if (sizeMB < 10)    return 2500;     // 2 MB - 10 MB
  return 5000;                         // > 10 MB
}

/**
 * Calculate optimal read chunk size (highWaterMark) from known byte size.
 * @param {number} fileSizeBytes
 * @returns {number} chunk size in bytes
 */
export function getReadChunkSize(fileSizeBytes) {
  if (!fileSizeBytes || typeof fileSizeBytes !== 'number') {
    return 256 * 1024; // 256 KB safe default
  }
  const sizeMB = fileSizeBytes / (1024 * 1024);
  if (sizeMB < 1)   return 64 * 1024;     // 64 KB
  if (sizeMB < 5)   return 256 * 1024;    // 256 KB
  if (sizeMB < 20)  return 512 * 1024;    // 512 KB
  if (sizeMB < 100) return 1024 * 1024;   // 1 MB
  return 2 * 1024 * 1024;                 // 2 MB
}
