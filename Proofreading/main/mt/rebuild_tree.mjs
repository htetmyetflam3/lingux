#!/usr/bin/env node
// Rebuild Engine/.cache-tree from the sealed master.
//
//   node --import ./scraper/wasm/box/runtime-guard.mjs mt/rebuild_tree.mjs
//
// Why the guard import: the builder calls MyNormalize(), which is the WASM map
// — there is no plaintext fallback in this checkout.
//
// What it writes: the four cache files and the hashes in
// Engine/CACHE-SOURCE.json, because tag-text.mjs, tag-both.mjs and
// Engine/tag-text.mjs all refuse a cache whose hash does not match that file.
//
// What it does NOT run: runBuildPos(). That one prunes dictionary rows from the
// master it is handed — tag-both.mjs passes it a scratch copy for that reason —
// so the POS tree is still built at tag time, never stored.
//
//   --out DIR      write the tree somewhere else (default Engine/.cache-tree)
//   --no-record    do not touch Engine/CACHE-SOURCE.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const outDir = path.resolve(flag('--out', path.join(ROOT, 'Engine/.cache-tree')));
const record = !args.includes('--no-record');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-tree-'));
for (const dir of ['log', 'out', 'data']) fs.mkdirSync(path.join(scratch, dir), { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const { configureWorkspace } = await import(path.join(ROOT, 'Engine/Bridge/path.js'));
configureWorkspace({
  treeDir: outDir,
  logDir: path.join(scratch, 'log'),
  outputDir: path.join(scratch, 'out'),
  dataDir: path.join(scratch, 'data'),
});
const { init } = await import(path.join(ROOT, 'Engine/Bridge/logen.js'));
init({ DEBUG: false, MODE: 'multi', SEGMENTED_MODE: 'fromdisk' });
const { runBuild } = await import(path.join(ROOT, 'Engine/MonoSyllabism/graph/build.js'));

const built = await runBuild(undefined, outDir);
const units = Array.isArray(built.refArray) ? built.refArray.length : 0;

const names = ['ref-syllables.json', 'rtl-tree.json', 'syllable.mapped.txt', 'syllable.tree.json'];
const sha256 = {};
for (const name of names) {
  sha256[name] = crypto.createHash('sha256').update(fs.readFileSync(path.join(outDir, name))).digest('hex');
}

console.log(`[tree] ${units} units -> ${path.relative(ROOT, outDir) || outDir}`);
for (const name of names) console.log(`  ${sha256[name].slice(0, 16)}  ${name}`);

if (record) {
  const sourcePath = path.join(ROOT, 'Engine/CACHE-SOURCE.json');
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  source.sha256 = sha256;
  source.counts = { ...(source.counts ?? {}), units };
  source.rebuilt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(sourcePath, JSON.stringify(source, null, 2) + '\n');
  console.log('[tree] Engine/CACHE-SOURCE.json updated');
}

fs.rmSync(scratch, { recursive: true, force: true });
