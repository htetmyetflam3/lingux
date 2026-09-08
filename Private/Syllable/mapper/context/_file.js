import fs from 'fs';

export function getBatchSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB < 1) return Infinity;
    if (sizeMB < 2) return 300;
    if (sizeMB < 5) return 500;
    return 1000;
  } catch {
    return 1000;
  }
}
/**
 * Split a buffer at its last newline.
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
 * Calculate optimal read chunk size from known byte size.
 * @param {number} fileSizeBytes
 * @returns {number} chunk size in bytes
 */
export function getReadChunkSize(fileSizeBytes) {
  const sizeMB = fileSizeBytes / (1024 * 1024);
  if (sizeMB < 1)   return 64 * 1024;     
  if (sizeMB < 5)   return 256 * 1024;    
  if (sizeMB < 20)  return 512 * 1024;    
  if (sizeMB < 100) return 1024 * 1024;   
  return 2 * 1024 * 1024;                 
}