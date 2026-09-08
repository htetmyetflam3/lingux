


// FILE: idmapper.js
import fs from 'fs';
import path from 'path';
import { TreeFile } from'../../../Bridge/path.js';

let _asciiToId = null, _idToAscii = null, _burmeseToId = null, _idToBurmese = null;

function loadMappings() {
  // Placeholder: loads syllable ID mappings from file
  if (_asciiToId) return;
  _asciiToId = new Map(); _idToAscii = new Map();
  _burmeseToId = new Map(); _idToBurmese = new Map();
  const mapPath = path.join(TreeFile(), 'syllable.mapped.txt');
  if (!fs.existsSync(mapPath)) { console.warn(`[syllableToID] Not found: ${mapPath}`); return; }
  for (const line of fs.readFileSync(mapPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(':').map(p => p.trim().replace(/^["']|["']$/g, ''));
    if (parts.length < 3) continue;
    const [burmese, ascii, id] = parts;
    if (ascii && id) { _asciiToId.set(ascii, id); _idToAscii.set(id, ascii); }
    if (burmese && id) { _burmeseToId.set(burmese, id); _idToBurmese.set(id, burmese); }
  }
  console.log(`[syllableToID] Loaded ${_asciiToId.size} ascii→id, ${_idToBurmese.size} id→burmese`);
}

export function asciiToId(syllable) { loadMappings(); return _asciiToId?.get(syllable) ?? null; }
export function burmeseToId(syllable) { loadMappings(); return _burmeseToId?.get(syllable) ?? null; }
export function idToBurmese(id) { loadMappings(); return _idToBurmese?.get(id) ?? null; }
export function idToAscii(id) { loadMappings(); return _idToAscii?.get(id) ?? null; }
export function resetIdLookup() { _asciiToId = _idToAscii = _burmeseToId = _idToBurmese = null; }