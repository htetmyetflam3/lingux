import { getBatchSize } from '../../Private/monoSyllabism/main/grapheme/loaded.js';
export { getBatchSize };

const DELIMITER = '  ';

function getSyllables(token) {
  return token.syllables ?? [];
}

function getId(token) {
  return token.ids?.join('') ?? '';
}

// ── Formatters ──

export function formatRawSegmented(lineResult) {
  const parts = [];
  for (const token of lineResult.tokens ?? []) {
    parts.push(...getSyllables(token));
  }
  return parts.join(DELIMITER);
}

export function formatAsIds(lineResult) {
  const parts = [];
  for (const token of lineResult.tokens ?? []) {
    parts.push(getId(token));
  }
  return parts.join(DELIMITER);
}

export function formatAsTaggedIds(lineResult) {
  const parts = [];
  for (const token of lineResult.tokens ?? []) {
    const id = getId(token);
    const pos = token.rawPos?.[0] ?? '?';
    parts.push(`${id}{${pos}}`);
  }
  if (lineResult.isEos) parts.push('<EOS>{eos}');
  return parts.join(DELIMITER);
}

export function formatAsFinalPos(lineResult) {
  const parts = [];
  for (const token of lineResult.tokens ?? []) {
    const id = getId(token);
    const pos = token.finalPos ?? '?';
    parts.push(`${id}{${pos}}`);
  }
  if (lineResult.isEos) parts.push('<EOS>{eos}');
  return parts.join(DELIMITER);
}

// ── Writers (legacy non-generator) ──
export async function writeResolved(ruleGen, writer) {
  for await (const line of ruleGen) {
    writer.writeLine([formatAsFinalPos(line)]);
  }
  writer.flush();
}

export async function writeAsIds(ruleGen, writer) {
  for await (const line of ruleGen) {
    writer.writeLine([formatAsIds(line)]);
  }
  writer.flush();
}

export function formatAsAscii(lineResult) {
  return formatRawSegmented(lineResult);
}

export async function writeAsAscii(ruleGen, writer) {
  return writeResolved(ruleGen, writer);
}
