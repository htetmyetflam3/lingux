import { getBatchSize } from '../context/sizer.js';
export { getBatchSize };

const DELIMITER = '  ';

function getSyllables(token) {
  return token.syllables ?? [];
}

// ── Formatters ──

export function toBurmeseLine(lineResult) {
  const parts = [];
  for (const token of lineResult.tokens ?? []) {
    parts.push(...getSyllables(token));
  }
  return parts.join(DELIMITER);
}

export function toBurmeseLineWithPos(lineResult, posField = 'finalPos') {
  const parts = [];
  for (const token of lineResult.tokens ?? []) {
    const burmese = getSyllables(token).join('');
    const pos = token[posField] ?? '?';
    parts.push(`${burmese}{${pos}}`);
  }
  if (lineResult.isEos) parts.push('<EOS>{eos}');
  return parts.join(DELIMITER);
}

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
