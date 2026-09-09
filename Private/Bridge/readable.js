/* --- ruleEngine/writereadable.js --- */
import fs from 'fs';
import { toBurmeseStr } from '../Syllable/mapper/map/map-loader.js';

export function formatResolvedLine(lineResult) {
  const parts = [];
  for (const token of lineResult.tokens) {
    const ids = token.joinedIds ?? token.ids.join('');
    const pos = token.finalPos ?? '?';
    parts.push(`${ids}{${pos}}`);
  }
  if (lineResult.isEos) {
    parts.push('<EOS>  {eos}');
  }
  return parts.join('  ');
}

/**
 * Writes resolved lines from a generator to a stream writer.
 * DOES NOT close the writer — caller closes after all batches.
 */
export async function writeResolved(ruleGen, writer) {
  for await (const lineResult of ruleGen) {
    const line = formatResolvedLine(lineResult);
    writer.writeLine([line]);
  }
  writer.flush();
  // DO NOT close here — batch loop reuses the same writer
}

export function makeReadable(syllables) {
  const joined = syllables.join('  ');
  let out = toBurmeseStr(joined);
  out = out.replace(/[{}]/g, '');
  return out;
}

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
