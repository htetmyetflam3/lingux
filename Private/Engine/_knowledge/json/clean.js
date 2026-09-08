/*
 * Description: Cleans dictionary.RBNV against all 9 function-word sources:
 *   Top (3):    top.wibat, top.conjunction, top.particle
 *   Dict (3):   dictionary.WIBAT, dictionary.CONJUNCTION, dictionary.PARTICLE
 *   Res (3):    resolution .w, resolution .c, resolution .p
 *   Guards against missing/empty RBNV.
 *   Reads: ./master.json
 *   Outputs: ./master.json (modified), ./output/rbnv-clean-report.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const MASTER_FILE = resolve(process.cwd(), "master.json");
const OUT_DIR = resolve(process.cwd(), "output");
const REPORT_FILE = resolve(OUT_DIR, "rbnv-clean-report.json");

mkdirSync(OUT_DIR, { recursive: true });

function norm(w) {
  return typeof w === "string" ? w.replace(/ /g, "").replace(/\u00A0/g, "") : "";
}

function collectStrings(obj, out = new Set()) {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === "string") out.add(item);
      else collectStrings(item, out);
    }
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof k === "string") out.add(k);
      collectStrings(v, out);
    }
  } else if (typeof obj === "string") {
    out.add(obj);
  }
  return out;
}

function parseResolutionTagged(resolution) {
  const forbidden = new Set();
  const CAT_RE = /\.([wcp])$/i;

  function route(word, tag) {
    if (!tag || typeof tag !== "string") return;
    const m = tag.match(CAT_RE);
    if (m) forbidden.add(word);
  }

  for (const [word, entry] of Object.entries(resolution.single || {})) {
    route(word, entry.default);
    if (Array.isArray(entry.categories)) {
      for (const c of entry.categories) route(word, c);
    }
    if (entry.position) {
      for (const v of Object.values(entry.position)) {
        if (Array.isArray(v)) for (const x of v) route(word, x);
        else route(word, v);
      }
    }
    if (entry.style) {
      for (const styleObj of Object.values(entry.style)) {
        for (const [key, val] of Object.entries(styleObj)) {
          if (key === "!default") {
            if (typeof val === "string") route(val, entry.default);
            else if (Array.isArray(val)) for (const v2 of val) route(v2, entry.default);
          } else {
            route(word, key);
            if (typeof val === "string") route(val, key);
            else if (Array.isArray(val)) for (const v2 of val) route(v2, key);
          }
        }
      }
    }
  }

  const group = resolution.group || {};
  for (const arr of Object.values(group.tonkens || {})) {
    if (Array.isArray(arr)) {
      for (const word of arr) {
        if (typeof word === "string") forbidden.add(word);
      }
    }
  }

  for (const w of collectStrings(resolution)) forbidden.add(w);
  return forbidden;
}

const raw = readFileSync(MASTER_FILE, "utf8");
const data = JSON.parse(raw);
const dict = data.dictionary || {};
const top = data.top || {};
const resolution = data.resolution || {};

const rbnvArr = dict.RBNV;
if (!Array.isArray(rbnvArr) || rbnvArr.length === 0) {
  console.log("WARNING: dictionary.RBNV missing or empty. Nothing to clean.");
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILD FORBIDDEN POOL — 9 SOURCES
// ═══════════════════════════════════════════════════════════════════════════
const forbidden = new Set();

// ── TOP (3 sources) ──
for (const w of collectStrings(top.wibat || {})) forbidden.add(norm(w));
for (const w of collectStrings(top.conjunction || {})) forbidden.add(norm(w));
for (const w of collectStrings(top.particle || {})) forbidden.add(norm(w));

// ── DICTIONARY (3 sources) ──
for (const w of (dict.WIBAT || [])) if (typeof w === "string") forbidden.add(norm(w));
for (const w of (dict.CONJUNCTION || [])) if (typeof w === "string") forbidden.add(norm(w));
for (const w of (dict.PARTICLE || [])) if (typeof w === "string") forbidden.add(norm(w));

// ── RESOLUTION (3 sources: .w + .c + .p) ──
for (const w of parseResolutionTagged(resolution)) forbidden.add(norm(w));

console.log(`Forbidden pool (9 sources, normalized): ${forbidden.size}`);

// ═══════════════════════════════════════════════════════════════════════════
// FILTER RBNV
// ═══════════════════════════════════════════════════════════════════════════
const kept = [];
const removed = [];

for (const w of rbnvArr) {
  if (typeof w !== "string") { kept.push(w); continue; }
  if (forbidden.has(norm(w))) removed.push(w);
  else kept.push(w);
}

dict.RBNV = kept;
writeFileSync(MASTER_FILE, JSON.stringify(data, null, 2));

const report = {
  meta: { source: MASTER_FILE, generated: new Date().toISOString() },
  counts: {
    originalRBNV: rbnvArr.length,
    kept: kept.length,
    removed: removed.length,
    forbiddenPool: forbidden.size,
  },
  removed,
  remaining: kept,
};

writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

console.log("=== RBNV Clean Complete ===");
console.log(`Original RBNV:  ${rbnvArr.length}`);
console.log(`Forbidden pool: ${forbidden.size}`);
console.log(`  Kept:         ${kept.length}`);
console.log(`  Removed:      ${removed.length}`);
console.log(`Final RBNV:     ${dict.RBNV.length}`);
