/* Every distinct case where ေ sits between two consonant clusters.
 *
 * Emits a table the reader can rule on: for each pattern, what the text
 * says today (ေ stays on the first consonant) and what it would say if ေ
 * moved behind the second one.
 *
 *   node analysis/vector-medial/e-bind-list.mjs <rawFile> [outFile]
 */
import fs from 'node:fs';
import path from 'node:path';

const [rawFile, outFile = '/tmp/e-bind.tsv'] = process.argv.slice(2);
const text = fs.readFileSync(rawFile, 'utf8');

const mono = '/home/user/linga/.debug/mono';
const ref = JSON.parse(fs.readFileSync(path.join(mono, 'File/.tree/ref-syllables.json'), 'utf8')).map((x) => x.original);
const inv = JSON.parse(fs.readFileSync('/home/user/linga/.debug/vector-eval/ve/Parsed/parser/tools/vector-evaluation/snapshot/linga/Parsed/parser/map/burmese-inventory.json', 'utf8')).syllables;
const INV = new Set([...ref, ...inv]);

const { reorderMarks } = await import('/home/user/linga/Parsed/parser/text/cleanup.mjs');

const CONS = /[က-အဥဧ]/;
const MARK = /[ာ-်ျြွှ]/;
const E = '\u1031';

/* Where ေ lands when it moves. Not straight after the first character --
   a cluster can open with medials (ြကာ), and ေ belongs behind the
   CONSONANT they belong to, with the run put back in canonical order.
   အေ|ြကာ is အ|ကြော, not အ|ြေကာ. */
function moved(B) {
  let k = 0;
  while (k < B.length && 'ြျွှ'.includes(B[k])) k += 1;
  return reorderMarks(B.slice(0, k) + B[k] + E + B.slice(k + 1));
}

// Walk back from `i` to the start of the cluster that owns position i-1.
function clusterBefore(t, i) {
  let a = i - 1;
  if (a < 0 || !CONS.test(t[a])) return null;
  while (a > 0 && MARK.test(t[a - 1]) && !CONS.test(t[a - 1])) a -= 1;
  // a virama (U+1039) glues the previous consonant on: ကမ္ဘာ is one cluster
  if (a > 0 && t[a - 1] === '\u1039') return null;
  return t.slice(a, i);
}
// Walk forward from the ေ: skip medials, take the consonant and its marks.
function clusterAfter(t, j) {
  let k = j;
  while (k < t.length && 'ြျွှ'.includes(t[k])) k += 1;
  if (k >= t.length || !CONS.test(t[k])) return null;
  let e = k + 1;
  while (e < t.length && MARK.test(t[e]) && !CONS.test(t[e])) e += 1;
  return t.slice(j, e);
}

const rows = new Map();
for (let i = 0; i < text.length; i += 1) {
  if (text[i] !== E) continue;
  const A = clusterBefore(text, i);
  if (A === null) continue;                       // not behind a consonant
  const B = clusterAfter(text, i + 1);
  if (B === null) continue;                       // no owner behind it
  const stay = A + E;                             // ေ stays:  Aေ | B
  const move = moved(B);                           // ေ moves: A | Bေ
  const key = `${A}\t${B}`;
  if (!rows.has(key)) {
    rows.set(key, { A, B, stay, move, n: 0,
      stayOk: INV.has(stay), moveOk: INV.has(move), aOk: INV.has(A), bOk: INV.has(B) });
  }
  rows.get(key).n += 1;
}

const list = [...rows.values()].sort((a, b) => b.n - a.n);
const verdict = (r) => {
  const stay = r.aOk && r.stayOk && r.bOk;
  const move = r.aOk && r.moveOk;
  if (stay && !move) return 'stay';
  if (move && !stay) return 'MOVE';
  if (stay && move) return 'ambiguous';
  return 'neither';
};

const head = ['n', 'verdict', 'today (ေ stays)', 'if ေ moves', 'patterns'];
const lines = [head.join('\t')];
for (const r of list) {
  lines.push([r.n, verdict(r), `${r.stay}|${r.B}`, `${r.A}|${r.move}`, `${r.stay} ${r.B}  /  ${r.A} ${r.move}`].join('\t'));
}
fs.writeFileSync(outFile, lines.join('\n'));

const tally = {};
for (const r of list) { const v = verdict(r); tally[v] = (tally[v] || 0) + r.n; }
console.log('distinct patterns:', list.length);
console.log('occurrences by inventory verdict:', JSON.stringify(tally));
console.log('written to', outFile);

/* Markdown view: the patterns that occur often enough to be worth a rule,
   grouped by what the inventory already knows. */
const md = [];
md.push('# ေ between two consonant clusters\n');
md.push(`Source: ${path.basename(rawFile)}  ·  ${list.length} distinct patterns  ·  ${[...rows.values()].reduce((a, r) => a + r.n, 0)} occurrences\n`);
md.push('`today` = ေ stays on the first consonant (what the parser does now).');
md.push('`moved` = ေ goes behind the second consonant.\n');
for (const v of ['MOVE', 'ambiguous', 'stay', 'neither']) {
  const group = list.filter((r) => verdict(r) === v);
  const n = group.reduce((a, r) => a + r.n, 0);
  md.push(`\n## ${v} — ${group.length} patterns, ${n} occurrences\n`);
  md.push('| n | today | moved |');
  md.push('|--:|-------|-------|');
  for (const r of group.slice(0, v === 'ambiguous' ? 60 : 40)) {
    md.push(`| ${r.n} | ${r.stay} ${r.B} | ${r.A} ${r.move} |`);
  }
  if (group.length > (v === 'ambiguous' ? 60 : 40)) md.push(`| … | *${group.length - (v === 'ambiguous' ? 60 : 40)} more* | |`);
}
fs.writeFileSync('/tmp/e-bind.md', md.join('\n'));
console.log('markdown ->/tmp/e-bind.md');
