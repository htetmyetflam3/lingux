/* ═══════════════════════════════════════════════════════════════
   Module-store.js (renamed from _writer.js — stream + tree writers)
   ═══════════════════════════════════════════════════════════════ */

import fs from 'fs';
import { writerStart, writerEnd, writerWrote, getDateTimeHash } from '../../../Bridge/logen.js';
import { OutputFile, TreeFile, joinPath } from '../../../Bridge/path.js';
let _sessionHash = null;
export function getHash() {
  if (!_sessionHash) _sessionHash = getDateTimeHash();
  return _sessionHash;
}
export function resetHash() {
  _sessionHash = null;
}
export function setHash(hash) {
  _sessionHash = hash;
}
export function writeTreeToDir(treeData, treeDir = TreeFile()) {
  const filePath = joinPath(treeDir, 'syllable.tree.json');
  fs.writeFileSync(filePath, JSON.stringify(treeData, null, 2), 'utf8');
  return filePath;
}
export function writeMappedToDir(lines, treeDir = TreeFile()) {
  const filePath = joinPath(treeDir, 'syllable.mapped.txt');
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  return filePath;
}
export function writeRtlToDir(rtlData, treeDir = TreeFile()) {
  const filePath = joinPath(treeDir, 'rtl-tree.json');
  fs.writeFileSync(filePath, JSON.stringify(rtlData, null, 2), 'utf8');
  return filePath;
}
export function writeRefToDir(refData, treeDir = TreeFile()) {
  const filePath = joinPath(treeDir, 'ref-syllables.json');
  fs.writeFileSync(filePath, JSON.stringify(refData, null, 2), 'utf8');
  return filePath;
}
export function writeOutput(syllablesPerLine, outputDir = OutputFile()) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  writerStart({ outputDir, lineCount: syllablesPerLine.length });
  const ts = getHash();
  const outputPath = joinPath(outputDir, `segmented_${ts}.txt`);
  const lines = syllablesPerLine.map((syllables) => syllables.join('  '));
  fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
  writerWrote({ path: outputPath, lines: lines.length });
  writerEnd({ path: outputPath });
  return outputPath;
}
export function createStreamWriter(outputDir = OutputFile(), suffix = '', batchSize = 1000) {
  const ts = getHash();
  const suffixPart = suffix ? `_${suffix}` : '';
  const outputPath = joinPath(outputDir, `segmented_${ts}${suffixPart}.txt`);
  let lineCount = 0;
  let buffer = '';
  fs.writeFileSync(outputPath, '', 'utf8');
  writerStart({ outputDir, lineCount: 0 });
  function flush() {
    if (buffer.length === 0) return;
    fs.appendFileSync(outputPath, buffer, 'utf8');
    buffer = '';
  }
  return {
    outputPath,
    writeLine(syllables) {
      buffer += syllables.join('  ') + '\n';
      lineCount++;
      if (lineCount % batchSize === 0) flush();
    },
    flush,
    close() {
      flush();
      writerWrote({ path: outputPath, lines: lineCount });
      writerEnd({ path: outputPath });
      return outputPath;
    },
  };
}
export function writeTree(filePath, treeData) {
  fs.writeFileSync(filePath, JSON.stringify(treeData, null, 2), 'utf8');
  return filePath;
}
