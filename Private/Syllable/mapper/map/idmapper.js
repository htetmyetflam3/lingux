import fs from 'fs';
import path from 'path';
import { TreeFile } from '../../Bridge/path.js';

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
  if (!fs.existsSync(mapPath)) {
    console.warn(`[syllableToID] Not found: ${mapPath}`);
    return;
  }

  const content = fs.readFileSync(mapPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed
      .split(':')
      .map(p => p.trim().replace(/^["']|["']$/g, ''));

    if (parts.length < 3) continue;

    const [burmese, ascii, id] = parts;

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
