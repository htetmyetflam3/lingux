// Offline production entry: supplied Engine + freshly rebuilt required WASM.
//
// New engine shape: the tagger is reached through ONE boundary — the
// repo-root Bridge facade re-exporting Engine/index.js (BindEngine). No
// Engine/Bridge shims, no graph/build.js, no deep MonoSyllabism imports. The
// engine consumes the prebuilt .cache-tree as-is; this entry only audits the
// supplied inputs, seeds the disposable work dir, makes the single
// BindEngine('proofreading') path-A call, and writes the stats JSON.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BindEngine, configureWorkspace, readFileContent } from '../../../Bridge/path.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const [sourceArg, workArg, resultArg] = process.argv.slice(2);
if (!sourceArg || !workArg || !resultArg) {
  console.error('usage: node --import ./scraper/wasm/box/runtime-guard.mjs Engine/tag-text.mjs SOURCE_TEXT WORK_DIR RESULT_JSON');
  process.exit(2);
}
if (globalThis[Symbol.for('proofreading.scraper.wasm-only')] !== true) {
  throw new Error('Required WASM-only production guard is missing; run uv run format/tag_docx.py');
}
const { getBox, assertMapData } = await import('../scraper/wasm/box/host.mjs');
getBox(); // Require the actual shared WASM box before any tagging work.
const source = path.resolve(sourceArg), work = path.resolve(workArg);
const masterPath = path.join(ROOT, 'Engine/knowledge/isTreasure/master.json');
const masterBytes = fs.readFileSync(masterPath), masterHash = hash(masterBytes);
const build = JSON.parse(fs.readFileSync(path.join(ROOT, 'scraper/wasm/box/build-info.json')));
// top/resolution belong to comparison. Only actual normalizer-table changes
// require rebuilding the box; the POS dictionary ships prebuilt in .cache-tree.
const masterData = JSON.parse(masterBytes);
assertMapData(masterData.mapData);
const treeDir = path.join(work, 'tree'), dataDir = path.join(work, 'data');
const outputDir = path.join(work, 'out'), logDir = path.join(work, 'log');
for (const dir of [treeDir, dataDir, outputDir, logDir]) fs.mkdirSync(dir, {recursive:true});
const cacheRoot = path.join(ROOT, 'Engine/.cache-tree');
const cacheSource = JSON.parse(fs.readFileSync(path.join(ROOT, 'Engine/CACHE-SOURCE.json')));
for (const [name, expected] of Object.entries(cacheSource.sha256)) {
  const bytes = fs.readFileSync(path.join(cacheRoot, name));
  if (hash(bytes) !== expected) throw new Error(`Original scraper cache hash mismatch: ${name}`);
  fs.writeFileSync(path.join(treeDir, name), bytes);
}
// Never let the supplied builder's cleanup overwrite the owner's master.
fs.writeFileSync(path.join(dataDir, 'master.json'), masterBytes);
// New shape: no POS rebuild. The prebuilt pos.tree.json is a load-time input,
// so it is seeded above and must not be removed. Only a stale fail log from an
// older run is cleared.
fs.rmSync(path.join(treeDir, 'pos-fail.txt'), { force: true });
configureWorkspace({treeDir, dataDir, outputDir, logDir});

// Single engine call: signature 'proofreading' is path A (fullstopHolder ->
// runTagger -> pass-through rule engine, syllable + raw_pos writers). The
// source hash names segmented_<hash>_* and is validated as a flat token.
const session = hash(fs.readFileSync(source)).slice(0, 24);
const result = await BindEngine('proofreading', { hash: session, inputPath: source });
if (!result.rawPosPath || !fs.statSync(result.rawPosPath).size) throw new Error('No tagged output produced');
if (hash(fs.readFileSync(masterPath)) !== masterHash) throw new Error('Original master was modified');
// Engine output is read back with the engine's own stream reader, not host fs.
const raw = await readFileContent(result.rawPosPath);
const failFile = path.join(treeDir, 'pos-fail.txt');
const prebuiltPosTree = path.join(treeDir, 'pos.tree.json');
const posRoots = fs.existsSync(prebuiltPosTree)
  ? Object.keys(JSON.parse(fs.readFileSync(prebuiltPosTree, 'utf8'))).length
  : 0;
const stats = {
  runtime:'required rebuilt scraper WASM',
  runtime_guard:'scraper/wasm/box/runtime-guard.mjs',
  plain_source_runtime_blocked:true,
  wasm_box:'scraper/wasm/box/box.wasm',
  wasm_host:'scraper/wasm/box/host.mjs',
  wasm_instance_scope:'shared module instance',
  input_pipeline:"BindEngine('proofreading') path A; prebuilt .cache-tree loaded, never rebuilt",
  engine_entry:'Engine/index.js via repo-root Bridge/path.js facade',
  wasm_sha256:build.box_sha256, master_sha256:masterHash,
  tag_data_sha256:hash(JSON.stringify({dictionary:masterData.dictionary,mapData:masterData.mapData})),
  scraper_cache_commit:cacheSource.commit,
  source_sha256:hash(fs.readFileSync(source)),
  raw_pos_path:result.rawPosPath, raw_pos_sha256:hash(Buffer.from(raw)),
  raw_pos_bytes:Buffer.byteLength(raw), output_units:result.lineCount,
  pos_tree_roots:posRoots,
  rejected_dictionary_entries:fs.existsSync(failFile) ? fs.readFileSync(failFile,'utf8').trim().split('\n').filter(Boolean).length : 0,
  tag_occurrences:[...raw.matchAll(/\{[^{}]+\}/g)].length,
  unknown_tag_occurrences:[...raw.matchAll(/\{\?\}/g)].length,
  ambiguous_tag_occurrences:[...raw.matchAll(/\{[^{}]*,[^{}]*\}/g)].length,
  rule_engine:'owner pass-through; raw POS candidates retained, not grammar-disambiguated',
  phrase_alignment:'not established',
  original_master_unchanged:true,
};
fs.writeFileSync(path.resolve(resultArg), JSON.stringify(stats,null,2)+'\n');
console.log(`[tagged] ${result.lineCount} units -> ${result.rawPosPath}`);
