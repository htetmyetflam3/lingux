import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const box = path.resolve(import.meta.dirname, '..');
const root = path.resolve(box, '../../..');
const hash = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const files = [
  ...['function.js', 'normalize.js', 'sourceMap.js', 'sourceMapper.js'].map(name => 'Engine/MonoSyllabism/mapbuilder/base/' + name),
  'Engine/knowledge/isTreasure/master.json',
  'scraper/wasm/box/c/shim.c', 'scraper/wasm/box/engine-api.mjs',
  'scraper/wasm/box/build-payload.mjs', 'scraper/wasm/box/loader.mjs',
];
const info = {
  runtime: 'WASM only', plain_source_runtime: false, bytecode_fallback: false,
  input_sha256: Object.fromEntries(files.map(name => [name, hash(name)])),
  box_sha256: hash('scraper/wasm/box/box.wasm'),
  node: process.version,
  zig: execFileSync('python3', ['-m', 'ziglang', 'version'], {encoding:'utf8'}).trim(),
  quickjs_commit: execFileSync('git', ['-C', process.env.QJS_SRC, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
};
fs.writeFileSync(path.join(box, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log('WASM build recorded:', info.box_sha256);
