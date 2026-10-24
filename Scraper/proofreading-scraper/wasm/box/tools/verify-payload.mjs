#!/usr/bin/env node
// Is the shipped WASM still the code that is on disk?
//
// The box embeds four engine modules plus the mapData section of master.json,
// all inside an AES-GCM payload. This script decrypts that payload with the
// loader's own key and compares every module byte for byte against the source
// tree, so "the binary is stale" becomes a fact with a diff instead of a guess.
//
//   node scraper/wasm/box/tools/verify-payload.mjs
//
// Exit 0 = the binary is the current source. Exit 1 = rebuild it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decryptToLoad } from '../loader.mjs';

const box = path.resolve(import.meta.dirname, '..');
const root = path.resolve(box, '../../..');
const base = path.join(root, 'Engine/MonoSyllabism/mapbuilder/base');
const knowledge = path.join(root, 'Engine/knowledge/isTreasure/master.json');

const bytes = fs.readFileSync(path.join(box, 'box.wasm'));
const info = JSON.parse(fs.readFileSync(path.join(box, 'build-info.json'), 'utf8'));
const actual = crypto.createHash('sha256').update(bytes).digest('hex');
if (actual !== info.box_sha256) {
  console.error(`box.wasm ${actual} does not match build-info ${info.box_sha256}`);
  process.exit(1);
}

const section = WebAssembly.Module.customSections(new WebAssembly.Module(bytes), 'linga.payload');
if (section.length !== 1) {
  console.error('box.wasm has no readable linga.payload section');
  process.exit(1);
}
const pack = JSON.parse(decryptToLoad(new Uint8Array(section[0])));

/* build-payload.mjs inlines master.json[mapData] and drops duplicate exports;
   replay that transformation so the comparison is against what was packed. */
function sourceOf(name) {
  let src = fs.readFileSync(path.join(base, name), 'utf8');
  src = src.replace(
    /import\s+(\w+)\s+from\s+["'][^"']*master\.json["']\s+with\s*\{[^}]*\}\s*;/g,
    (_, key) => `const ${key} = ${JSON.stringify(JSON.parse(fs.readFileSync(knowledge, 'utf8'))[key])};`,
  );
  const consts = new Set([...src.matchAll(/export\s+const\s+(\w+)/g)].map((m) => m[1]));
  return src.replace(/export\s*\{([^}]*)\}\s*;/g, (whole, list) => {
    const keep = list.split(',').map((s) => s.trim()).filter(Boolean)
      .filter((n) => !consts.has(n.split(/\s+as\s+/)[0].trim()));
    return keep.length ? `export { ${keep.join(', ')} };` : '';
  });
}

const files = [['function.js', '_function.js'], ['normalize.js', 'normalize.js'],
  ['sourceMap.js', 'sourceMap.js'], ['sourceMapper.js', 'sourceMapper.js']];
let stale = 0;
for (const [disk, key] of files) {
  const live = sourceOf(disk), shipped = pack[key] ?? '';
  const ok = live === shipped;
  if (!ok) stale++;
  console.log(`${ok ? 'ok  ' : 'STALE'} ${key.padEnd(16)} ${live.length} B`);
  if (!ok) {
    const a = live.split('\n'), b = shipped.split('\n');
    let i = 0;
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
    console.log(`      first difference at line ${i + 1}`);
    console.log(`      disk   : ${JSON.stringify((a[i] ?? '').slice(0, 140))}`);
    console.log(`      shipped: ${JSON.stringify((b[i] ?? '').slice(0, 140))}`);
  }
}
const api = fs.readFileSync(path.join(box, 'engine-api.mjs'), 'utf8');
const apiOk = api === pack['engine-api.js'];
if (!apiOk) stale++;
console.log(`${apiOk ? 'ok  ' : 'STALE'} engine-api.js`);

console.log(stale ? `\n${stale} module(s) differ: rebuild the WASM (npm run build:wasm).`
  : `\nbox.wasm ${actual.slice(0, 16)} carries the current sources.`);
process.exit(stale ? 1 : 0);
