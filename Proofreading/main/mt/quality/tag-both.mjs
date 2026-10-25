// Read-only sibling of Proofreading/plugin/engine/tag-text.mjs.
//
// tag-text.mjs publishes the word view; quality work needs both views at once
// — the word view (which dictionary entry matched) and the smallest-unit view
// (how the segmentor cut the cluster) — because a bad cluster shows up as an
// orphan mark in the word view and as a stray piece in the unit view.
//
// New engine shape: the tagger is reached through ONE boundary, the repo-root
// Bridge facade re-exporting Engine/index.js (BindEngine). No Engine/Bridge
// shims, no graph/build.js, no deep MonoSyllabism imports. The engine loads
// the prebuilt .cache-tree as-is; this entry only audits inputs, seeds the
// disposable WORK dir, and makes the single BindEngine('proofreading') call.
//
// Nothing here writes into Engine/: master.json is copied, the cache files
// are copied into WORK, and the hash of master.json is re-checked at the end.
// The only outputs are inside WORK.
//
// usage: node --import ./scraper/wasm/box/runtime-guard.mjs \
//          mt/quality/tag-both.mjs SOURCE_TEXT WORK_DIR RESULT_JSON
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BindEngine, configureWorkspace, readFileContent } from '../../../../Bridge/path.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..'); // deployment bundle root (Engine/, scraper/)
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
// New shape: no POS rebuild — the prebuilt pos.tree.json is a load-time input
// and stays seeded. Only a stale fail log from an older run is cleared.
fs.rmSync(path.join(treeDir, 'pos-fail.txt'), { force: true });
configureWorkspace({ treeDir, dataDir, outputDir, logDir });

const session = hash(fs.readFileSync(source)).slice(0, 24);
/* proofreading is path A: syllable:true + rawPos:true — the whole reason
   this quality sibling exists. One boundary call, dual writers. */
const result = await BindEngine('proofreading', { hash: session, inputPath: source });
if (!result.rawPosPath || !result.syllablePath) throw new Error('Engine did not produce both views');
if (hash(fs.readFileSync(masterPath)) !== masterHash) throw new Error('Original master was modified');

const raw = await readFileContent(result.rawPosPath);
const failFile = path.join(treeDir, 'pos-fail.txt');
const prebuiltPosTree = path.join(treeDir, 'pos.tree.json');
const posRoots = fs.existsSync(prebuiltPosTree)
  ? Object.keys(JSON.parse(fs.readFileSync(prebuiltPosTree, 'utf8'))).length
  : 0;
const stats = {
  runtime: 'required rebuilt scraper WASM',
  runtime_guard: 'scraper/wasm/box/runtime-guard.mjs',
  engine_entry: 'Engine/index.js via repo-root Bridge/path.js facade',
  wasm_sha256: build.box_sha256,
  master_sha256: masterHash,
  source_sha256: hash(fs.readFileSync(source)),
  raw_pos_path: result.rawPosPath,
  syllable_path: result.syllablePath,
  output_units: result.lineCount,
  pos_tree_roots: posRoots,
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
