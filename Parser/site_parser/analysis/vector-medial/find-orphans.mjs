/* Where does the segmentor orphan a tail?
 *   node analysis/vector-medial/find-orphans.mjs <monoRoot> <file> <tail> [maxShow]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [monoRootArg, fileArg, tail = 'ဇ်', maxShow = '10'] = process.argv.slice(2);
const monoRoot = path.resolve(monoRootArg);
const cwd0 = process.cwd();
const file = path.resolve(cwd0, fileArg);
process.chdir(monoRoot);

const { readAndPrepare } = await import(pathToFileURL(path.join(monoRoot, 'MonoSyllabism/generators/input.js')).href);
const { runSegmentor } = await import(pathToFileURL(path.join(monoRoot, 'MonoSyllabism/main/phoneme/lexer.js')).href);
const { InputFile } = await import(pathToFileURL(path.join(monoRoot, 'Bridge/path.js')).href);
fs.mkdirSync(path.dirname(path.join(monoRoot, InputFile())), { recursive: true });
fs.copyFileSync(file, path.join(monoRoot, InputFile()));

// Keep a rolling window of emitted tokens so an orphan can be shown in place.
const window = [];
const N = 18;
let shown = 0; let total = 0;
for await (const tok of runSegmentor(readAndPrepare(inputPath))) {
  const t = tok.replace('√', '');
  window.push(t);
  if (window.length > N) window.shift();
  if (t.trim() === tail) {
    total += 1;
    if (shown < Number(maxShow)) {
      console.log(`...${window.join('|')}...`);
      shown += 1;
    }
  }
}
console.log(`\ntotal orphan '${tail}' tokens: ${total}`);
