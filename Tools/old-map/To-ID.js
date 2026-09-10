import { asciiToId, burmeseToId } from '../../Private/monoSyllabism/mapper/idmapper.js';

const DELIMITER = '  ';

// ── Array helpers ──
export function asciiSyllablesToIds(syllables) {
  return syllables.map(s => asciiToId(s) ?? s);
}

export function burmeseSyllablesToIds(syllables) {
  return syllables.map(s => burmeseToId(s) ?? s);
}

// ── Token helpers ──
export function tokensToAsciiIds(tokens) {
  return tokens.map(t => {
    const key = t.joinedIds ?? t.ids?.join('') ?? '';
    return asciiToId(key) ?? key;
  });
}

export function tokensToBurmeseIds(tokens) {
  return tokens.map(t => {
    const key = t.burmese ?? t.joinedIds ?? t.ids?.join('') ?? '';
    return burmeseToId(key) ?? key;
  });
}

// ── Generators: syllable arrays → ID arrays ──
export async function* fromAsciiSyllables(syllableGen) {
  for await (const syllables of syllableGen) {
    yield asciiSyllablesToIds(syllables);
  }
}

export async function* fromBurmeseSyllables(syllableGen) {
  for await (const syllables of syllableGen) {
    yield burmeseSyllablesToIds(syllables);
  }
}

// ── Generators: lineResult → ID line strings ──
export async function* fromAsciiLineResults(lineGen) {
  for await (const line of lineGen) {
    yield tokensToAsciiIds(line.tokens ?? []).join(DELIMITER);
  }
}

export async function* fromBurmeseLineResults(lineGen) {
  for await (const line of lineGen) {
    yield tokensToBurmeseIds(line.tokens ?? []).join(DELIMITER);
  }
}

// ── Standalone: consume raw segmentor directly (no raw file output) ──
export async function* fromSegmentor(seg) {
  let currentLine = [];
  for await (const item of seg) {
    if (item === '\n') {
      if (currentLine.length) {
        yield asciiSyllablesToIds(currentLine).join(DELIMITER);
      }
      currentLine = [];
      continue;
    }
    if (item.syllable !== undefined) {
      currentLine.push(item.syllable);
    }
  }
  if (currentLine.length) {
    yield asciiSyllablesToIds(currentLine).join(DELIMITER);
  }
}
