import { getFlushLines } from '../../Private/monoSyllabism/main/grapheme/loaded.js';
export { getFlushLines };

import { toBurmeseLine, toBurmeseLineWithPos } from '../../Private/Bridge/readable.js';

const DELIMITER = '  ';

export function toBurmeseCluster(lineResult) {
  return toBurmeseLine(lineResult);
}

// ── Writers ──
export async function* writeSyllable(lineGen, writer) {
  for await (const line of lineGen) {
    writer.writeLine([toBurmeseLine(line)]);
    yield line;
  }
  writer.flush();
}

export async function* writeRawPos(lineGen, writer) {
  for await (const line of lineGen) {
    writer.writeLine([toBurmeseLineWithPos(line, 'rawPos')]);
    yield line;
  }
  writer.flush();
}

export async function* writeFinalPosBurmese(lineGen, writer) {
  for await (const line of lineGen) {
    writer.writeLine([toBurmeseLineWithPos(line, 'finalPos')]);
    yield line;
  }
  writer.flush();
}

export async function* writeCluster(lineGen, writer) {
  for await (const line of lineGen) {
    writer.writeLine([toBurmeseCluster(line)]);
    yield line;
  }
  writer.flush();
}

// ── Legacy ──
export function makeReadable(syllables) {
  return syllables.join(DELIMITER);
}
