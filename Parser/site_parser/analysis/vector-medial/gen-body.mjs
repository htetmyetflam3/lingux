/* Burmese-body text for measurement.
 *
 * Emits only Burmese-majority lines, so the file's own Latin scaffolding
 * (header, --- Page N ---) cannot leak into the score: those characters
 * pass through the segmentor's mapper and come back as runs of
 * consonant+်, which reads as thousands of broken syllables and is purely
 * an artefact of what was fed in.
 *
 *   node analysis/vector-medial/gen-body.mjs <pdf> <outFile>
 */
import fs from 'node:fs';
import { streamPdfPages, processPageRecord, loadDetector } from '/home/user/linga/Parsed/parser/pipeline.mjs';

const [pdf, out] = process.argv.slice(2);
const det = loadDetector();
const [, , pages] = streamPdfPages(pdf, det, () => {}, {});
const body = [];
let n = 0;
for (const pg of pages) { body.push(processPageRecord(pg, det, true, () => {}, false).text); n += 1; }
const keep = [];
for (const l of body.join('\n').split('\n')) {
  const b = [...l].filter((c) => c.codePointAt(0) >= 0x1000 && c.codePointAt(0) <= 0x109f).length;
  if (!b) continue;
  if (l.length && b / l.length < 0.5) continue;
  keep.push(l);
}
fs.writeFileSync(out, keep.join('\n'));
console.log(`${out}: ${n} pages, ${keep.length} lines`);
