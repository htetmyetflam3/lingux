/* --- ruleEngine/writereadable.js --- */
import { toBurmeseStr } from '../monoSyllabism/mapper/map/map-loader.js';

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

export function makeReadable(syllables) {
  const joined = syllables.join('  ');
  let out = toBurmeseStr(joined);
  out = out.replace(/[{}]/g, '');
  return out;
}

// ── Line formatters (moved from mapper/generator/BurmeseTranslator.js) ──
const DELIMITER = '  ';

function getSyllables(token) {
  return token.syllables ?? [];
}

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

// ── Piece assembler (moved from Bridge/bridge.js bridgeSyllable) ──
// \n-assembler for the syllable-only path. Pieces arrive √-suffixed
// from the segmentor — pure concat, no array, no join. Bare "\n" is
// the control signal: emit the line.
export async function* toLineStrings(seg) {
  let line = '';
  for await (const item of seg) {
    if (item === '\n') {
      yield line;
      line = '';
      continue;
    }
    if (typeof item !== 'string') continue;
    line += item;
  }
  if (line.length) yield line;
}

export function toSyllableLine(lineStr) {
  return lineStr
    .split('√')
    .filter((t) => t.trim())
    .join('  ');
}

