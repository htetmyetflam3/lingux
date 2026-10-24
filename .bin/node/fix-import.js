#!/usr/bin/env node
/**
 * fix-import.js
 * Category: fix
 * Auto-detect and fix broken import paths across ESM .js/.mjs files. Interactive confirmation.
 * self-scan-exclusion: 7f3a91c0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = path.resolve(fileURLToPath(import.meta.url));
// This exact marker line makes every copy of this script skip itself,
// so its regex/comment text can never pollute the export map.
const SELF_MARKER = 'self-scan-exclusion: 7f3a91c0';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => rl.question(q, a => res(a.trim())));

let filesScanned = 0;
let filesModified = 0;
let importsFixed = 0;
let importsVerified = 0;
let importsBroken = 0;

// ---------------------------------------------------------------------------
// Project root: taken from the CLI arg (default "."), then climbed up to the
// nearest ancestor containing package.json / .git / node_modules.
// ---------------------------------------------------------------------------
const START_DIR = path.resolve(process.argv[2] || '.');
const ROOT_MARKERS = ['package.json', '.git', 'node_modules'];
const MAX_ROOT_CLIMB = 6;

function findProjectRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < MAX_ROOT_CLIMB; i++) {
    if (ROOT_MARKERS.some(m => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

const PROJECT_ROOT = findProjectRoot(START_DIR);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------
const fileExports = new Map(); // absPath -> Set<exportedName>
const exportMap   = new Map(); // exportedName -> Set<absPath>
const basenameMap = new Map(); // basename -> Set<absPath>
const indexed     = new Set();
const selfFiles   = new Set();

function addExport(filePath, name) {
  if (!fileExports.has(filePath)) fileExports.set(filePath, new Set());
  fileExports.get(filePath).add(name);
  if (!exportMap.has(name)) exportMap.set(name, new Set());
  exportMap.get(name).add(filePath);
}

// Strip comments before regexing exports, so examples in comments don't count.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function indexExports(filePath, content) {
  const src = stripComments(content);

  const declRe = /export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g;
  const varRe = /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  const listRe = /export\s*\{([^}]+)\}/g;
  const starRe = /export\s+\*\s+from\s+['"][^'"]+['"]/g;
  const nsRe = /export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"][^'"]+['"]/g;
  const defaultNamedRe = /export\s+default\s+(?:class|function)\s+([A-Za-z_$][\w$]*)/g;

  let m;
  while ((m = declRe.exec(src)) !== null) addExport(filePath, m[1]);
  while ((m = varRe.exec(src)) !== null) addExport(filePath, m[1]);
  while ((m = listRe.exec(src)) !== null) {
    m[1].split(',').forEach(part => {
      const segs = part.trim().split(/\s+as\s+/);
      const name = segs[segs.length - 1].trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) addExport(filePath, name);
    });
  }
  // `export * from '...'` -> wildcard marker ("re-exports unknown names")
  while ((m = starRe.exec(src)) !== null) addExport(filePath, '*');
  while ((m = nsRe.exec(src)) !== null) addExport(filePath, m[1]);
  if (/export\s+default\b/.test(src)) addExport(filePath, 'default');
  while ((m = defaultNamedRe.exec(src)) !== null) addExport(filePath, m[1]);
}

function ensureIndexed(filePath) {
  if (indexed.has(filePath)) return;
  let st;
  try { st = fs.statSync(filePath); } catch { return; }
  if (!st.isFile()) return;
  let content;
  try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return; }
  indexed.add(filePath);
  if (filePath === __filename || content.includes(SELF_MARKER)) {
    selfFiles.add(filePath);
    return;
  }
  indexExports(filePath, content);
  const bn = path.basename(filePath);
  if (!basenameMap.has(bn)) basenameMap.set(bn, new Set());
  basenameMap.get(bn).add(filePath);
}

function isDotFile(name) { return name.startsWith('.'); }
function shouldSkipDir(name) { return name === 'node_modules' || name === '.git' || isDotFile(name); }

function scanTree(dir, skipDirs = new Set()) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (isDotFile(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (shouldSkipDir(e.name) || skipDirs.has(full)) continue;
      out.push(...scanTree(full, skipDirs));
    } else if (e.isFile() && /\.(js|mjs)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const allFiles = scanTree(PROJECT_ROOT);
for (const f of allFiles) ensureIndexed(f);
const realCount = allFiles.length - selfFiles.size;

console.log(`Start dir:    ${START_DIR}`);
console.log(`Project root: ${PROJECT_ROOT}`);
console.log(`Indexed ${realCount} .js/.mjs files (skipped ${selfFiles.size} copy/copies of this script).`);
console.log(`Indexed exports from ${realCount} files.\n`);

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------
const IMPORT_RE = /import\s+(?:type\s+)?(?:(?:\{[^}]*\}|[A-Za-z_$][\w$]*(?:\s*,\s*\{[^}]*\})?|\*\s+as\s+\w+)\s+from\s+)?['"]([^'"]+)['"]|import\s*\(['"]([^'"]+)['"]\)/g;

function parseImports(content) {
  const out = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const p = m[1] || m[2];
    const full = m[0];
    const pIdx = m.index + full.indexOf(p);
    out.push({ path: p, pIdx, pEnd: pIdx + p.length, ...extractImportInfo(full, p) });
  }
  return out;
}

function extractImportInfo(fullImport, importPath) {
  const names = [];
  let defaultBinding = null;
  let isStar = false;

  const beforePath = fullImport.slice(0, fullImport.indexOf(importPath));
  let stmt = beforePath.replace(/^import\s*/, '').replace(/\s+from\s*$/, '').trim();

  if (!stmt) return { names, defaultBinding, isStar }; // side-effect import
  if (stmt.startsWith('type ')) stmt = stmt.slice(5).trim();

  if (stmt.startsWith('*')) {
    // `import * as ns` needs NO named exports — never treat it as requiring '*'
    return { names, defaultBinding, isStar: true };
  }

  const comboMatch = stmt.match(/^([A-Za-z_$][\w$]*)\s*,\s*(.*)$/);
  if (comboMatch) {
    defaultBinding = comboMatch[1];
    names.push('default');
    stmt = comboMatch[2].trim();
  }

  if (stmt.startsWith('{')) {
    const braceMatch = stmt.match(/\{([^}]*)\}/);
    if (braceMatch) {
      for (const part of braceMatch[1].split(',')) {
        const segs = part.trim().split(/\s+as\s+/);
        const name = segs[segs.length - 1].trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
      }
    }
  } else if (!comboMatch) {
    const dm = stmt.match(/^([A-Za-z_$][\w$]*)$/);
    if (dm) { defaultBinding = dm[1]; names.push('default'); }
  }

  return { names, defaultBinding, isStar };
}

// ---------------------------------------------------------------------------
// Resolution & search
// ---------------------------------------------------------------------------
function isBareModule(p) { return !p.startsWith('.') && !path.isAbsolute(p); }

function relPath(fromFile, toFile) {
  const r = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/');
  return r.startsWith('.') ? r : './' + r;
}

function resolveImportPath(fromFile, importPath) {
  if (isBareModule(importPath)) return null;
  const base = importPath.startsWith('.')
    ? path.resolve(path.dirname(fromFile), importPath)
    : path.resolve(importPath);

  const tries = [];
  if (path.extname(base)) {
    tries.push(base);
    if (base.endsWith('.js')) tries.push(base.slice(0, -3) + '.mjs');
    else if (base.endsWith('.mjs')) tries.push(base.slice(0, -4) + '.js');
  } else {
    tries.push(base + '.js', base + '.mjs',
               path.join(base, 'index.js'), path.join(base, 'index.mjs'));
  }
  for (const t of tries) {
    try { if (fs.statSync(t).isFile()) return t; } catch {}
  }
  return null;
}

function fileProvidesAll(filePath, names) {
  if (!names || names.length === 0) return true;
  const pExports = fileExports.get(filePath);
  if (!pExports) return false;
  if (pExports.has('*')) return true; // wildcard re-exporter, assume it provides it
  return names.every(n => pExports.has(n));
}

function findFilesByExports(names) {
  if (!names || names.length === 0) return [];
  let candidates = null;
  for (const name of names) {
    const files = exportMap.get(name);
    if (!files) return [];
    if (candidates === null) candidates = new Set(files);
    else for (const f of [...candidates]) if (!files.has(f)) candidates.delete(f);
    if (candidates.size === 0) return [];
  }
  for (const f of [...candidates]) if (selfFiles.has(f)) candidates.delete(f);
  return [...candidates];
}

function basenameCandidates(importPath) {
  const bn = path.basename(importPath);
  const wanted = path.extname(bn) ? [bn] : [bn + '.js', bn + '.mjs'];
  const out = new Set();
  for (const w of wanted) {
    const s = basenameMap.get(w);
    if (s) for (const f of s) if (!selfFiles.has(f)) out.add(f);
  }
  return [...out];
}

function findCandidates(imp) {
  let cands = findFilesByExports(imp.names);
  if (cands.length === 0 && imp.names.length > 0) {
    const wild = [...(exportMap.get('*') || [])].filter(f => !selfFiles.has(f));
    if (wild.length) return wild;
  }
  if (cands.length === 0) cands = basenameCandidates(imp.path);
  return cands;
}

// If nothing is found, climb UP through ancestor directories and index them,
// so files living above the start dir (e.g. ../Bridge, ../Engine) are found.
const MAX_SEARCH_CLIMB = 6;
let climbed = false;

function findCandidatesWithClimb(imp) {
  let cands = findCandidates(imp);
  if (cands.length > 0 || climbed) return cands;
  let dir = path.dirname(PROJECT_ROOT);
  for (let level = 0; level < MAX_SEARCH_CLIMB && dir !== path.dirname(dir); level++) {
    for (const f of scanTree(dir, new Set([PROJECT_ROOT]))) ensureIndexed(f);
    cands = findCandidates(imp);
    if (cands.length > 0) return cands;
    dir = path.dirname(dir);
  }
  climbed = true;
  return cands;
}

function scoreDefaultMatch(filePath, defaultBinding) {
  let score = 0;
  const basename = path.basename(filePath).replace(/\.(m?js)$/, '').toLowerCase();
  const bindingLower = defaultBinding ? defaultBinding.toLowerCase() : '';
  if (bindingLower && basename === bindingLower) score += 30;
  else if (bindingLower && basename.includes(bindingLower)) score += 10;
  else if (bindingLower && bindingLower.includes(basename)) score += 5;
  const pExports = fileExports.get(filePath);
  if (pExports && defaultBinding && pExports.has(defaultBinding)) score += 15;
  return score;
}

// ---------------------------------------------------------------------------
// Fixing
// ---------------------------------------------------------------------------
async function fixFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const imports = parseImports(content);
  if (!imports.length) return;
  filesScanned++;

  let newContent = content;
  let offset = 0;
  let changed = false;

  for (const imp of imports) {
    const raw = imp.path;
    if (isBareModule(raw)) continue;

    const actualPath = resolveImportPath(filePath, raw);

    if (actualPath) {
      ensureIndexed(actualPath); // may live OUTSIDE the project root — index it too
      if (fileProvidesAll(actualPath, imp.names)) {
        importsVerified++;
        continue;
      }
      importsBroken++;
      console.log(`\n  [BROKEN] ${path.relative(PROJECT_ROOT, filePath)}`);
      console.log(`    Import: ${raw}`);
      console.log(`    File exists at: ${path.relative(PROJECT_ROOT, actualPath)}`);
      console.log(`    But it does NOT export: {${imp.names.join(', ')}}`);
    } else {
      importsBroken++;
      console.log(`\n  [MISSING] ${path.relative(PROJECT_ROOT, filePath)}`);
      console.log(`    Import: ${raw}`);
      console.log(`    File does NOT exist at this path`);
    }

    let candidates = findCandidatesWithClimb(imp);
    candidates = candidates.filter(c => c !== actualPath); // don't "fix" onto itself

    if (candidates.length > 1 && imp.defaultBinding) {
      const scored = candidates
        .map(p => ({ path: p, score: scoreDefaultMatch(p, imp.defaultBinding) }))
        .sort((a, b) => b.score - a.score);
      if (scored[0].score > 0 && scored[0].score > (scored[1]?.score || 0)) {
        candidates = [scored[0].path];
      }
    }

    if (candidates.length === 0) {
      console.log(`    [SKIP] No matching file found${climbed ? ' (searched upward too)' : ''}${imp.names.length ? ` for exports: {${imp.names.join(', ')}}` : ''}`);
      continue;
    }

    if (candidates.length > 1) {
      console.log(`    [SKIP] Multiple candidate files${imp.names.length ? ` exporting {${imp.names.join(', ')}}` : ''}:`);
      for (const c of candidates) {
        console.log(`      - ${path.relative(PROJECT_ROOT, c)}`);
      }
      continue;
    }

    const correctFile = candidates[0];
    const correctPath = relPath(filePath, correctFile);

    console.log(`    Found correct file: ${path.relative(PROJECT_ROOT, correctFile)}`);
    console.log(`    Suggested fix: ${raw} -> ${correctPath}`);

    const answer = await ask(`    Apply fix? [Y/N]: `);
    if (answer.toLowerCase() === 'y') {
      const s = imp.pIdx + offset;
      const e = imp.pEnd + offset;
      newContent = newContent.slice(0, s) + correctPath + newContent.slice(e);
      offset += correctPath.length - raw.length;
      importsFixed++;
      changed = true;
      console.log(`    [FIXED]`);
    } else {
      console.log(`    [SKIPPED]`);
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, newContent, 'utf-8');
    filesModified++;
  }
}

(async () => {
  for (const f of allFiles) {
    if (selfFiles.has(f)) continue;
    await fixFile(f);
  }
  console.log('\n' + '='.repeat(50));
  console.log(`Files scanned:    ${filesScanned}`);
  console.log(`Imports verified: ${importsVerified} (correct)`);
  console.log(`Imports broken:   ${importsBroken} (missing or wrong exports)`);
  console.log(`Imports fixed:    ${importsFixed}`);
  console.log(`Files modified:   ${filesModified}`);
  rl.close();
})();
