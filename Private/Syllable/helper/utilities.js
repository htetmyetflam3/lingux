/* --- helper/utilities.js --- */
import fs from 'fs';
import { DataFile, resolvePath } from '../../Bridge/path.js';
import { readSecureJson } from '../../Bridge/secure.js';

import { readerStart, readerEnd, readerFail } from '../../Bridge/logen.js';

export function getDateTimeHash() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${y}${m}${d}_${h}${min}${s}_${ms}`;
}

export function readFile(filePath, encoding = 'utf8') {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, encoding);
}

export function fileExists(filePath) {
  return fs.existsSync(filePath);
}

export function writeFile(filePath, content, encoding = 'utf8') {
  fs.writeFileSync(filePath, content, encoding);
  return filePath;
}

export function writeJson(filePath, data, space = 2) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, space), 'utf8');
  return filePath;
}

export function appendFile(filePath, content, encoding = 'utf8') {
  fs.appendFileSync(filePath, content, encoding);
  return filePath;
}

export function readLines(filePath) {
  const raw = readFile(filePath);
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function readInput(filePath) {
  readerStart({ filePath });
  const text = readFile(filePath);
  if (!text || typeof text !== 'string') {
    readerFail({ filePath, reason: 'not found or empty' });
    return null;
  }
  readerEnd({ filePath, length: text.length });
  return text;
}


export function parseJson(filePath = DataFile() + '/sid-syllables.json') {
  return readSecureJson(filePath);
}

export function parseLookupText(rawText) {
  const data = {};
  for (const line of rawText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const [id, ...seqParts] = parts;
      const seq = seqParts.join('');
      if (!seq) continue;
      const root = seq[0];
      if (!data[root]) data[root] = {};
      data[root][id] = seq;
    }
  }
  return Object.keys(data).length ? data : null;
}
