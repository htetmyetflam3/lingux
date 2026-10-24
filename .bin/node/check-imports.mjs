#!/usr/bin/env node
// FILE: utility-tools/check-imports.mjs
// ── Import-graph guard ───────────────────────────────────────────────────
// Resolves every relative import specifier in the repo against the file
// system and reports the ones that do not land on a real file.
//
// Why this exists: the three webs declare their layout in two path maps
// (R_Engine/Bridge/path.js, R_Site/_file/paths.js) and reach across webs by
// relative import. When a directory is renamed (Entry/ → init/,
// Operation/ → lib/entry/, MonoSyllabism/mapper/map → MonoSyllabism/map)
// every specifier written for the OLD depth silently breaks, and the web dies
// at boot with ERR_MODULE_NOT_FOUND. This script catches that in ~100ms,
// with no dependencies, before the server ever starts.
//
// Verdicts are split by reachability, because both classes deserve different
// treatment:
//   BROKEN  — the specifier is on a live boot graph (an entry point can reach
//             it). Node WILL throw. Exit 1.
//   ORPHAN  — the specifier resolves from a module no entry point imports
//             today. Loud warning, exit 0 (use --strict to fail on these too).
//
// Usage:  node utility-tools/check-imports.mjs [--strict] [--json]
// Run from: REPO ROOT (like every other web — the paths are cwd-relative).
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// The three webs' entry points: site, engine, SPA.
const ENTRIES = [
  "R_Site/index.js",
  "R_Engine/init/api-server.js",
  "R_Site/Build/spa/js/main.js",
];

// Never scanned: build output, runtime scratch, vendored bundles.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "frontend",
  ".output",
  ".tree",
  ".map",
  ".venv",
  "__pycache__",
  "Praser", // the Python parser project (fonts/pkl, no JS graph)
]);

// Vendored third-party bundles: their internal require('./x') calls are
// private to the bundle, not repo files.
const VENDORED = [
  "R_Site/Build/spa/js/progressbar.js",
  "R_Site/Build/spa/js/notyf.js",
  "R_Site/Build/spa/js/pdf.mjs",
  "R_Site/Build/spa/js/pdf.worker.mjs",
];

// `m` so ^ is a line start (a wrapped import is still one statement), and `d`
// so the reported line comes from the captured specifier itself — not from the
// start of a lazy match, which can begin on an earlier line.
const IMPORT_RE =
  /(?:^|;)[ \t]*(?:import|export)[\s\S]{0,400}?\bfrom\s*["']([^"']+)["']|(?:^|;)[ \t]*import\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/gmd;

function* walkJs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walkJs(full);
    } else if (/\.(?:js|mjs|cjs)$/.test(e.name) && !VENDORED.includes(path.relative(ROOT, full))) {
      yield full;
    }
  }
}

/**
 * Comment text is not code: blank it out so prose like `require('./x')` is
 * never read as an import edge. Blanked in place (same length, newlines kept)
 * so the reported line numbers stay true.
 */
function blankComments(src) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/.*$/gm, (_m, lead) => lead + blank(_m.slice(lead.length)));
}

/** Relative specifiers only — bare package names resolve via node_modules. */
function specifiersOf(file) {
  const src = blankComments(fs.readFileSync(file, "utf8"));
  const found = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    const spec = m[1] || m[2] || m[3] || m[4];
    if (!spec || (!spec.startsWith(".") && !spec.startsWith("/"))) continue;
    // Point at the specifier itself (the match may start lines earlier).
    const grp = [1, 2, 3, 4].find((i) => m.indices?.[i]);
    const at = grp ? m.indices[grp][0] : m.index;
    found.push({ spec, line: src.slice(0, at).split("\n").length });
  }
  return found;
}

/** Same contract as the path maps: extensionless specifiers get the ESM probe. */
function resolveSpecifier(fromFile, spec) {
  const target = path.isAbsolute(spec) ? spec : path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
  for (const cand of [`${target}.js`, `${target}.mjs`, `${target}.cjs`, `${target}.json`, path.join(target, "index.js")]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

// ── 1) Which modules does each web actually boot? (BFS over resolved edges) ──
const reachable = new Set();
{
  const queue = ENTRIES.map((e) => path.join(ROOT, e)).filter((f) => fs.existsSync(f));
  for (const f of queue) reachable.add(f);
  while (queue.length) {
    const file = queue.shift();
    for (const { spec } of specifiersOf(file)) {
      const target = resolveSpecifier(file, spec);
      if (target && !reachable.has(target)) {
        reachable.add(target);
        queue.push(target);
      }
    }
  }
}

// ── 2) Scan every repo module, classify each unresolved edge ──
const broken = [];
const orphan = [];
let scanned = 0;
let edges = 0;

for (const file of walkJs(ROOT)) {
  scanned++;
  for (const { spec, line } of specifiersOf(file)) {
    edges++;
    if (resolveSpecifier(file, spec)) continue;
    const rec = {
      file: path.relative(ROOT, file),
      line,
      spec,
      onBootGraph: reachable.has(file),
    };
    (rec.onBootGraph ? broken : orphan).push(rec);
  }
}

const fmt = (r) => `  ${r.file}:${r.line}\n      ✗ ${r.spec}`;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ scanned, edges, broken, orphan }, null, 2));
  process.exit(broken.length || (process.argv.includes("--strict") && orphan.length) ? 1 : 0);
}

console.log(`[imports] ${scanned} modules, ${edges} relative specifiers, ${reachable.size} reachable from the three entry points`);

if (broken.length) {
  console.error(`\n[imports] BROKEN on a live boot graph — the web will not start (${broken.length}):`);
  for (const r of broken) console.error(fmt(r));
}
if (orphan.length) {
  console.warn(`\n[imports] unresolved in modules no entry point imports (${orphan.length}):`);
  for (const r of orphan) console.warn(fmt(r));
}

const strict = process.argv.includes("--strict");
if (!broken.length && !orphan.length) {
  console.log("[imports] every relative import resolves ✓");
}
process.exit(broken.length || (strict && orphan.length) ? 1 : 0);
