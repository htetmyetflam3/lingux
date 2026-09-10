import path from 'path';
import { TreeFile } from '../../../Private/Bridge/path.js';
import { loadMappedRows } from '../../../Private/monoSyllabism/main/grapheme/loaded.js';

let _asciiToId = null;
let _idToAscii = null;
let _burmeseToId = null;
let _idToBurmese = null;

function loadMappings() {
  if (_asciiToId) return;

  _asciiToId = new Map();
  _idToAscii = new Map();
  _burmeseToId = new Map();
  _idToBurmese = new Map();

  const mapPath = path.join(TreeFile(), 'syllable.mapped.txt');
  const rows = loadMappedRows();
  if (!rows) {
    console.warn(`[syllableToID] Not found: ${mapPath}`);
    return;
  }

  for (const { burmese, ascii, id } of rows) {
    if (ascii && id) {
      _asciiToId.set(ascii, id);
      _idToAscii.set(id, ascii);
    }
    if (burmese && id) {
      _burmeseToId.set(burmese, id);
      _idToBurmese.set(id, burmese);
    }
  }

  console.log(
    `[syllableToID] Loaded ` +
    `${_asciiToId.size} ascii→id, ` +
    `${_idToBurmese.size} id→burmese`
  );
}

export function asciiToId(syllable) {
  if (!syllable) return null;
  loadMappings();
  return _asciiToId.get(syllable) ?? null;
}

export function burmeseToId(syllable) {
  if (!syllable) return null;
  loadMappings();
  return _burmeseToId.get(syllable) ?? null;
}

export function idToBurmese(id) {
  if (!id) return null;
  loadMappings();
  return _idToBurmese.get(id) ?? null;
}

export function idToAscii(id) {
  if (!id) return null;
  loadMappings();
  return _idToAscii.get(id) ?? null;
}

export function resetIdLookup() {
  _asciiToId = null;
  _idToAscii = null;
  _burmeseToId = null;
  _idToBurmese = null;
}
