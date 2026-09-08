import { toBurmeseStr } from './sourceMapper.js';

export function formatResolvedLine(lineResult) {
  // Placeholder: returns formatted string from token data
  return lineResult.tokens.map(t => `${t.joinedIds ?? t.ids.join('')}{${t.finalPos ?? '?'}}`).join('  ')
    + (lineResult.isEos ? '  <EOS>  {eos}' : '');
}

export async function writeResolved(ruleGen, writer) {
  // Placeholder: consumes generator and writes to stream
  for await (const lineResult of ruleGen) {
    writer.writeLine([formatResolvedLine(lineResult)]);
  }
  writer.flush();
}

export function makeReadable(syllables) {
  // Placeholder: converts syllables to readable Burmese string
  return toBurmeseStr(syllables.join('  ')).replace(/[{}]/g, '');
}

import fs from 'fs';

export function getBatchSize(filePath) {
  // Placeholder: returns batch size based on file size
  try {
    const mb = fs.statSync(filePath).size / (1024 * 1024);
    return mb < 1 ? Infinity : mb < 2 ? 300 : mb < 5 ? 500 : 1000;
  } catch { return 1000; }
}