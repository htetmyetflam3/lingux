/* The actual WORDS, not the two-cluster fragments.
 *
 * For every ေ sitting behind a consonant, take the whole word it is in
 * (Burmese run between spaces or punctuation) and show it as it reads
 * today against how it would read if ေ moved behind the next consonant.
 * Real words are what a rule can be written against.
 *
 *   node analysis/vector-medial/e-bind-words.mjs <rawFile> [outFile]
 */
import fs from 'node:fs';

const [rawFile, outFile = '/tmp/e-words.md'] = process.argv.slice(2);
const text = fs.readFileSync(rawFile, 'utf8');
const { reorderMarks } = await import('/home/user/linga/Parsed/parser/text/cleanup.mjs');

const mono = '/home/user/linga/.debug/mono';
const ref = JSON.parse(fs.readFileSync(`${mono}/File/.tree/ref-syllables.json`, 'utf8')).map((x) => x.original);
const inv = JSON.parse(fs.readFileSync('/home/user/linga/Parsed/parser/map/burmese-inventory.json', 'utf8')).syllables;
const INV = new Set([...ref, ...inv]);

const CONS = /[က-အဥဧ]/;
const MARK = /[ာ-်ျြွှ]/;
const E = '\u1031';
const BURMESE = /[\u1000-\u109F]/;

function moved(B) {
  let k = 0;
  while (k < B.length && 'ြျွှ'.includes(B[k])) k += 1;
  return reorderMarks(B.slice(0, k) + B[k] + E + B.slice(k + 1));
}

const rows = new Map();
for (let i = 0; i < text.length; i += 1) {
  if (text[i] !== E) continue;
  if (i === 0 || !CONS.test(text[i - 1])) continue;
  let j = i + 1;
  while (j < text.length && 'ြျွှ'.includes(text[j])) j += 1;
  if (j >= text.length || !CONS.test(text[j])) continue;
  let e = j + 1;
  while (e < text.length && MARK.test(text[e]) && !CONS.test(text[e])) e += 1;
  const before = text.slice(0, i);        // A ends right at i
  const A = (() => { let a = i - 1; while (a > 0 && MARK.test(text[a - 1]) && !CONS.test(text[a - 1])) a -= 1; return text.slice(a, i); })();
  const B = text.slice(i + 1, e);
  // whole word around the site
  let w0 = i, w1 = e;
  while (w0 > 0 && BURMESE.test(text[w0 - 1])) w0 -= 1;
  while (w1 < text.length && BURMESE.test(text[w1])) w1 += 1;
  const word = text.slice(w0, w1);
  // Splice: drop the ေ, then replace what was B with B carrying the ေ.
  const movedWord = reorderMarks(word.slice(0, i - w0) + moved(B) + word.slice(e - w0));
  const key = `${word}\t${movedWord}`;
  if (!rows.has(key)) {
    rows.set(key, { word, movedWord, n: 0, A, B, stay: A + E, mv: moved(B) });
  }
  rows.get(key).n += 1;
}

const list = [...rows.values()].sort((a, b) => b.n - a.n);
const verdict = (r) => {
  const s = r.A !== null && INV.has(r.stay) && INV.has(r.B);
  const m = INV.has(r.A) && INV.has(r.mv);
  return s && !m ? 'stay' : m && !s ? 'MOVE' : s && m ? 'ambiguous' : 'neither';
};

const md = ['# Words where ေ sits between two clusters\n'];
md.push(`Source: ${rawFile.split('/').pop()} · ${list.length} distinct words\n`);
for (const v of ['MOVE', 'ambiguous', 'stay', 'neither']) {
  const g = list.filter((r) => verdict(r) === v);
  md.push(`\n## ${v} — ${g.length} words, ${g.reduce((a, r) => a + r.n, 0)} occurrences\n`);
  md.push('| n | today | if ေ moves |');
  md.push('|--:|-------|-----------|');
  for (const r of g.slice(0, 120)) md.push(`| ${r.n} | ${r.word} | ${r.movedWord} |`);
  if (g.length > 120) md.push(`| … | *${g.length - 120} more* | |`);
}
fs.writeFileSync(outFile, md.join('\n'));
const t = {};
for (const r of list) { const v = verdict(r); t[v] = (t[v] || 0) + r.n; }
console.log('distinct words:', list.length, ' by verdict:', JSON.stringify(t));
