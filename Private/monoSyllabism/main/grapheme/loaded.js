import { TreeFile, DataFile } from '../../../Bridge/path.js';
import { readSecureText, readSecureJson } from '../../../Bridge/secure.js';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// Moved from helper/utilities.js (helper/ deleted): secure JSON load with
// plaintext fallback, used by the tree getters below.
export function parseJson(filePath = DataFile() + '/sid-syllables.json') {
  return readSecureJson(filePath);
}

// ============================================
// SYLLABLE TREE (forward + RTL)
// ============================================

let syllableTree = null;
let rtlTree = null;

export function getTree() {
  if (syllableTree) return syllableTree;
  const p = path.join(TreeFile(), 'syllable.tree.json');
  syllableTree = parseJson(p);
  if (!syllableTree) throw new Error(`Syllable tree failed to parse: ${p}`);
  return syllableTree;
}

export function resetTree() {
  syllableTree = null;
}

export function getRtlTree() {
  if (rtlTree) return rtlTree;
  const p = path.join(TreeFile(), 'rtl-tree.json');
  rtlTree = parseJson(p);
  if (!rtlTree) throw new Error(`RTL tree not found at: ${p}`);
  return rtlTree;
}

export function resetRtlTree() {
  rtlTree = null;
}

// Syllable tree steps: St-1, St-2, ... St-F
export function getStepKey(entry, stepNum) {
  if (!entry) return 'St-F';
  const numKey = `St-${stepNum}`;
  return entry[numKey] ? numKey : 'St-F';
}

// Syllable stepData is an array of { [token]: [...ids] }
export function findEntry(stepData, s, pos) {
  if (!stepData) return null;
  for (const item of stepData) {
    const tok = Object.keys(item)[0];
    if (s.startsWith(tok, pos)) {
      return { entry: item, tok, len: tok.length };
    }
  }
  return null;
}

// ============================================
// POS TREE
// ============================================

let posTree = null;

export function getPosTree() {
  if (posTree) return posTree;
  const p = path.join(TreeFile(), 'pos.tree.json');
  posTree = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return posTree;
}

export function resetPosTree() {
  posTree = null;
}

// POS tree steps: St-1, St-2, ... (capital S, matching builder)
export function getPosStepKey(stepNum) {
  return `St-${stepNum}`;
}

export function getPosStepData(node, stepNum) {
  return node?.[`St-${stepNum}`];
}

export function hasPosStep(node, stepNum) {
  return node?.[`St-${stepNum}`] !== undefined;
}

// ============================================
// SYLLABLE DATA LOADING (moved from graph/shape.js (ex-builder/_build.js))
// ============================================

function _extractSyllables(text) {
  const syllables = [];
  let inSyllables = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!inSyllables) {
      if (/^"syllables"\s*:\s*\[\s*$/.test(trimmed)) inSyllables = true;
      continue;
    }
    if (trimmed === ']' || trimmed.startsWith('],')) break;
    const match = line.match(/^\s*("(?:\\.|[^"\\])*")/);
    if (match) syllables.push(JSON.parse(match[1]));
  }
  return syllables;
}

export async function streamSyllables(jsonPath) {
  // If an encrypted <file>.enc exists, decrypt instead of streaming plaintext.
  if (fs.existsSync(jsonPath + '.enc')) {
    const text = readSecureText(jsonPath);
    return _extractSyllables(text);
  }
  const fileStream = fs.createReadStream(jsonPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const syllables = [];
  let inSyllables = false;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!inSyllables) {
      if (/^"syllables"\s*:\s*\[\s*$/.test(trimmed)) inSyllables = true;
      continue;
    }
    if (trimmed === ']' || trimmed.startsWith('],')) break;
    const match = line.match(/^\s*("(?:\\.|[^"\\])*")/);
    if (match) syllables.push(JSON.parse(match[1]));
  }

  return syllables;
}

export async function loadSyllablesData(jsonPath = DataFile() + '/master.json') {
  const syllables = await streamSyllables(jsonPath);
  if (!syllables.length) throw new Error(`No syllables found in ${jsonPath}`);
  return syllables;
}

// ============================================
// MAPPED-FILE LOADING (single home for syllable.mapped.txt parsing)
// ============================================
// Canonical reader — serves the build file-fallback (build.js runBuildPos)
// and the runtime lookup (Tools/map/mapper/idmapper.js). Returns rows or null when the
// file is absent (callers keep their own missing-file policy: build throws,
// lookup warns). opts.skipComments (default true): lookup behavior; build
// passes false to preserve its exact legacy parse. opts.onBadLine(n, line).
export function loadMappedRows(treeDir = TreeFile(), opts = {}) {
  const { skipComments = true, onBadLine = null } = opts;
  const p = path.join(treeDir, 'syllable.mapped.txt');
  if (!fs.existsSync(p)) return null;
  const rows = [];
  const content = fs.readFileSync(p, 'utf-8').replace(/^\uFEFF/, '');
  content.split('\n').forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (skipComments && trimmed.startsWith('#')) return;
    const parts = trimmed.split(':').map((pt) => pt.trim().replace(/^["']|["']$/g, ''));
    if (parts.length < 3) {
      if (onBadLine) onBadLine(idx + 1, trimmed);
      return;
    }
    rows.push({ burmese: parts[0], ascii: parts[1], id: parts[2] });
  });
  return rows;
}
