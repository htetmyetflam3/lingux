/* Syllable validity, measured with the project's OWN segmentor.
 *
 * Runs from the mono (architecture) checkout so Bridge/path.js resolves
 * File/.tree/. Feed it one or more text files; it segments each with
 * MonoSyllabism's runSegmentor and scores every syllable against the
 * reference inventory.
 *
 *   node analysis/vector-medial/segment-check.mjs <monoRoot> <file.txt> [...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [monoRootArg, ...fileArgs] = process.argv.slice(2);
const monoRoot = path.resolve(monoRootArg);
const cwd0 = process.cwd();
// Resolve before chdir: the segmentor's path helper reads File/.tree/ relative
// to the process cwd, so the run has to happen from the mono root.
const files = fileArgs.map((f) => path.resolve(cwd0, f));
if (!monoRootArg || !files.length) { console.error('usage: node segment-check.mjs <monoRoot> <file...>'); process.exit(1); }
process.chdir(monoRoot);

const { readAndPrepare } = await import(pathToFileURL(path.join(monoRoot, 'MonoSyllabism/generators/input.js')).href);
const { runSegmentor } = await import(pathToFileURL(path.join(monoRoot, 'MonoSyllabism/main/phoneme/lexer.js')).href);
const { InputFile } = await import(pathToFileURL(path.join(monoRoot, 'Bridge/path.js')).href);

const inputPath = path.join(monoRoot, InputFile());
fs.mkdirSync(path.dirname(inputPath), { recursive: true });

/* The valid set, pushed through the SAME round trip the segmentor uses.
 *
 * The segmentor emits Burmese by normalising, mapping to an internal ASCII
 * form, walking the tree, then mapping back. That round trip does not
 * return the input byte-for-byte -- ့ and ် come back in the mapper's own
 * order, for one -- so comparing its output against raw inventory strings
 * scores a difference in REPRESENTATION as a defect in the TEXT. Both
 * sides have to be normalised the same way before the comparison means
 * anything. */
const { normalize, mapperStr } = await import(pathToFileURL(path.join(monoRoot, 'MonoSyllabism/map/open-loader.js')).href);
const { toBurmeseStr } = await import(pathToFileURL(path.join(monoRoot, 'MonoSyllabism/map/open-loader.js')).href);

const roundTrip = (s) => toBurmeseStr(mapperStr(normalize(s)));

const rawInventory = [
  ...JSON.parse(fs.readFileSync(path.join(monoRoot, 'File/.tree/ref-syllables.json'), 'utf8')).map((x) => x.original),
  ...JSON.parse(fs.readFileSync('/home/user/linga/Parsed/parser/map/burmese-inventory.json', 'utf8')).syllables,
];
const INV = new Set();
for (const s of rawInventory) {
  INV.add(s);
  const rt = roundTrip(s);
  if (rt) INV.add(rt);
}

const SYL = '√';
// A syllable the segmentor could not resolve into the inventory at all.
const isBurmeseSyllable = (t) => /^[\u1000-\u109F]+$/.test(t);

/* What counts as a syllable candidate.
 *
 * A bare mark (း ့ ် ံ ေ ြ ာ ိ) or a bare digit is a token the segmentor
 * could not attach to anything -- an orphan, not a syllable. A lone
 * consonant with nothing after it is the same. Counting those as
 * "failing syllables" inflates the number with page numbers and stray
 * marks, so they are tallied separately and reported beside the real
 * figure rather than inside it. */
const isConsonant = (c) => { const n = c.codePointAt(0); return n >= 0x1000 && n <= 0x1021; };
const isBurmeseDigit = (t) => /^[\u1040-\u1049]+$/.test(t);
const isOrphanMark = (t) => [...t].length === 1 && !isConsonant(t) && /^[\u1000-\u109F]$/.test(t);

async function segmentFile(file) {
  fs.copyFileSync(file, inputPath);
  const counts = { valid: 0, invalid: 0, orphanMark: 0, orphanDigit: 0, nonBurmese: 0 };
  const bad = new Map();
  for await (const tok of runSegmentor(readAndPrepare(inputPath))) {
    const t = tok.replace(SYL, '').trim();
    if (!t) continue;
    const core = t.replace(/[\s။၊ .,!?"'()]/g, '');
    if (!core) continue;
    if (!isBurmeseSyllable(core)) { counts.nonBurmese += 1; continue; }
    if (isBurmeseDigit(core)) { counts.orphanDigit += 1; continue; }
    if (isOrphanMark(core)) { counts.orphanMark += 1; continue; }
    if (!isConsonant(core[0])) { counts.orphanMark += 1; continue; }
    if (INV.has(core)) counts.valid += 1;
    else { counts.invalid += 1; bad.set(core, (bad.get(core) || 0) + 1); }
  }
  return { counts, bad };
}

for (const file of files) {
  const { counts, bad } = await segmentFile(file);
  const tot = counts.valid + counts.invalid;
  const pct = tot ? (100 * counts.valid) / tot : 0;
  console.log(`\n${path.basename(file)}`);
  console.log(`  SYLLABLES ${tot}   valid ${counts.valid} (${pct.toFixed(1)}%)   FAILING ${counts.invalid} (${(100 - pct).toFixed(1)}%)`);
  console.log(`  (not syllables, tallied apart: bare marks ${counts.orphanMark}, page digits ${counts.orphanDigit})`);
  console.log('  top failing: ' + [...bad.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([s, n]) => `${s}(${n})`).join(' '));
}
