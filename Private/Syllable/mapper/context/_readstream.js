import fs from 'fs';
import { resolvePath } from '../../../Bridge/path.js';
const CHUNK_SIZE = 256 * 1024;
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