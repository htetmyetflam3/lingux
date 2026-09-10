import { toBurmeseStr } from '../../Private/monoSyllabism/mapper/map/map-loader.js';

const DELIMITER = '  ';

function joinSyllables(syllables) {
  return syllables.join(DELIMITER);
}

export function lineToBurmese(asciiLine) {
  if (!asciiLine) return '';
  return toBurmeseStr(asciiLine);
}

export async function* toBurmeseLines(asciiLineGen) {
  for await (const line of asciiLineGen) {
    yield lineToBurmese(line);
  }
}

export function syllablesToBurmese(asciiSyllables) {
  const joined = joinSyllables(asciiSyllables);
  return toBurmeseStr(joined);
}
