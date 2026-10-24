// Read-only sibling of Engine/tag-text.mjs.
//
// Engine/tag-text.mjs hard-codes {syllable:false, rawPos:true}, so it only
// publishes the word view. Quality work needs both views at once — the word
// view (which dictionary entry matched) and the smallest-unit view (how the
// segmentor cut the cluster) — because a bad cluster shows up as an orphan
// mark in the word view and as a stray piece in the unit view.
//
// Nothing here writes into Engine/: master.json is copied, the POS tree and
// the cache files are copied into WORK, and the hash of master.json is
// re-checked at the end exactly like tag-text.mjs does. The only outputs are
// inside WORK.
//
// usage: node --import ./scraper/wasm/box/runtime-guard.mjs \
//          mt/quality/tag-both.mjs SOURCE_TEXT WORK_DIR RESULT_JSON
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const [sourceArg, workArg, resultArg] = process.argv.slice(2);
if (!sourceArg || !workArg || !resultArg) {
  console.error('usage: node --import ./scraper/wasm/box/runtime-guard.mjs mt/quality/tag-both.mjs SOURCE_TEXT WORK_DIR RESULT_JSON');
  process.exit(2);
}
if (globalThis[Symbol.for('proofreading.scraper.wasm-only')] !== true) {
  throw new Error('Required WASM-only production guard is missing; run with --import ./scraper/wasm/box/runtime-guard.mjs');
}
const { getBox, assertMapData } = await import(path.join(ROOT, 'scraper/wasm/box/host.mjs'));
getBox();

const source = path.resolve(sourceArg), work = path.resolve(workArg);
const masterPath = path.join(ROOT, 'Engine/knowledge/isTreasure/master.json');
const masterBytes = fs.readFileSync(masterPath), masterHash = hash(masterBytes);
const build = JSON.parse(fs.readFileSync(path.join(ROOT, 'scraper/wasm/box/build-info.json')));
const masterData = JSON.parse(masterBytes);
assertMapData(masterData.mapData);

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
for (const name of ['pos.tree.json', 'pos-fail.txt']) fs.rmSync(path.join(treeDir, name), { force: true });

const { configureWorkspace } = await import(path.join(ROOT, 'Engine/Bridge/path.js'));
configureWorkspace({ treeDir, dataDir, outputDir, logDir });
const { init: initLog } = await import(path.join(ROOT, 'Engine/Bridge/logen.js'));
initLog({ DEBUG: false, MODE: 'multi', SEGMENTED_MODE: 'fromdisk' });
const { runBuildPos } = await import(path.join(ROOT, 'Engine/MonoSyllabism/graph/build.js'));
const tree = await runBuildPos(treeDir);
if (!Object.keys(tree).length) throw new Error('POS build produced an empty tree');
const { readAndPrepare } = await import(path.join(ROOT, 'Engine/MonoSyllabism/generators/input.js'));
const { runSegmentor } = await import(path.join(ROOT, 'Engine/MonoSyllabism/main/phoneme/lexer.js'));
const { setHash } = await import(path.join(ROOT, 'Engine/MonoSyllabism/utilities/disk.js'));
const { bridge } = await import(path.join(ROOT, 'Engine/Bridge/bridge.js'));

const session = hash(fs.readFileSync(source)).slice(0, 24);
setHash(session);
/* syllable:true + rawPos:true — the whole reason this file exists. */
const result = await bridge(runSegmentor(readAndPrepare(source)), { syllable: true, rawPos: true }, session, source);
if (!result.rawPosPath || !result.syllablePath) throw new Error('Engine did not produce both views');
if (hash(fs.readFileSync(masterPath)) !== masterHash) throw new Error('Original master was modified');

const raw = fs.readFileSync(result.rawPosPath, 'utf8');
const failFile = path.join(treeDir, 'pos-fail.txt');
const stats = {
  runtime: 'required rebuilt scraper WASM',
  runtime_guard: 'scraper/wasm/box/runtime-guard.mjs',
  wasm_sha256: build.box_sha256,
  master_sha256: masterHash,
  source_sha256: hash(fs.readFileSync(source)),
  raw_pos_path: result.rawPosPath,
  syllable_path: result.syllablePath,
  output_units: result.lineCount,
  pos_tree_roots: Object.keys(tree).length,
  rejected_dictionary_entries: fs.existsSync(failFile)
    ? fs.readFileSync(failFile, 'utf8').trim().split('\n').filter(Boolean).length
    : 0,
  tag_occurrences: [...raw.matchAll(/\{[^{}]+\}/g)].length,
  unknown_tag_occurrences: [...raw.matchAll(/\{\?\}/g)].length,
  ambiguous_tag_occurrences: [...raw.matchAll(/\{[^{}]*,[^{}]*\}/g)].length,
  rule_engine: 'owner pass-through; raw POS candidates retained, not grammar-disambiguated',
  original_master_unchanged: true,
};
fs.writeFileSync(path.resolve(resultArg), JSON.stringify(stats, null, 2) + '\n');
console.log(`[tagged] ${result.lineCount} units -> ${result.rawPosPath}`);
