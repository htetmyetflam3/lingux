// Syllable-only path: the segmentor with the tagger never constructed.
//
// Engine/init/cli.js picks this when writePos is off:
//     writeFlags.rawPos ? bridge(...) : bridgeSyllable(...)
// bridgeSyllable() consumes the segmentor generator directly, so it is the
// ground truth for "how the engine cuts this text into units", independent of
// the POS tree. Comparing this file with tag-both.mjs separates a segmentor
// split from a dictionary/trie miss.
//
// usage: node --import ./scraper/wasm/box/runtime-guard.mjs \
//          mt/quality/units.mjs SOURCE_TEXT WORK_DIR RESULT_JSON
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const [sourceArg, workArg, resultArg] = process.argv.slice(2);
if (!sourceArg || !workArg || !resultArg) {
  console.error('usage: node --import ./scraper/wasm/box/runtime-guard.mjs mt/quality/units.mjs SOURCE_TEXT WORK_DIR RESULT_JSON');
  process.exit(2);
}
if (globalThis[Symbol.for('proofreading.scraper.wasm-only')] !== true) {
  throw new Error('Required WASM-only production guard is missing');
}
const { getBox, assertMapData } = await import(path.join(ROOT, 'scraper/wasm/box/host.mjs'));
getBox();

const source = path.resolve(sourceArg), work = path.resolve(workArg);
const masterPath = path.join(ROOT, 'Engine/knowledge/isTreasure/master.json');
const masterBytes = fs.readFileSync(masterPath);
assertMapData(JSON.parse(masterBytes).mapData);

const treeDir = path.join(work, 'tree'), dataDir = path.join(work, 'data');
const outputDir = path.join(work, 'out'), logDir = path.join(work, 'log');
for (const dir of [treeDir, dataDir, outputDir, logDir]) fs.mkdirSync(dir, { recursive: true });
const cacheRoot = path.join(ROOT, 'Engine/.cache-tree');
const cacheSource = JSON.parse(fs.readFileSync(path.join(ROOT, 'Engine/CACHE-SOURCE.json')));
for (const [name, expected] of Object.entries(cacheSource.sha256)) {
  const bytes = fs.readFileSync(path.join(cacheRoot, name));
  if (hash(bytes) !== expected) throw new Error(`Original scraper cache hash mismatch: ${name}`);
  fs.writeFileSync(path.join(treeDir, name), bytes);
}
fs.writeFileSync(path.join(dataDir, 'master.json'), masterBytes);

const { configureWorkspace } = await import(path.join(ROOT, 'Engine/Bridge/path.js'));
configureWorkspace({ treeDir, dataDir, outputDir, logDir });
const { init: initLog } = await import(path.join(ROOT, 'Engine/Bridge/logen.js'));
initLog({ DEBUG: false, MODE: 'multi', SEGMENTED_MODE: 'fromdisk' });
const { readAndPrepare } = await import(path.join(ROOT, 'Engine/MonoSyllabism/generators/input.js'));
const { runSegmentor } = await import(path.join(ROOT, 'Engine/MonoSyllabism/main/phoneme/lexer.js'));
const { setHash } = await import(path.join(ROOT, 'Engine/MonoSyllabism/utilities/disk.js'));
const { bridgeSyllable } = await import(path.join(ROOT, 'Engine/Bridge/bridge.js'));

const session = hash(fs.readFileSync(source)).slice(0, 24);
setHash(session);
const result = await bridgeSyllable(
  runSegmentor(readAndPrepare(source)),
  { syllable: true, rawPos: false },
  session,
  source,
);
if (!result.syllablePath) throw new Error('segmentor produced no syllable file');
fs.writeFileSync(
  path.resolve(resultArg),
  JSON.stringify({ syllable_path: result.syllablePath, output_units: result.lineCount }, null, 2) + '\n',
);
console.log(`[units] ${result.lineCount} lines -> ${result.syllablePath}`);
