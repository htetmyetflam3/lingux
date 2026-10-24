#!/usr/bin/env node
/**
 * Export the map runtime's normalization tables into the praser's own model dir.
 *
 * Why a copy: the praser is a separate web and runs without the engine's compiled
 * map-runtime.jsc, so it vendors what it needs — the same way cleanup.py carries its
 * own _PRIORITY/_IMPOSTER_REPS instead of importing the map. This script exists so the
 * copy is GENERATED from the source of truth and never hand-typed.
 *
 * Note the difference this closes: cleanup.py's _PRIORITY stops at 16 (visarga), while
 * the map's Priority continues '\u0020': 17, '\u000A': 18 — space and newline sort at the
 * END of a mark cluster. The owner called the Python table "incomplete"; the praser's
 * `normalize`/`mynormalize` modes use the COMPLETE one from here, while the `cleanup`
 * gate keeps applying cleanup.py's own 16-entry order (that is the Python-parity path).
 *
 * Usage (from the repo root):  node .bin/gen-praser-normalize.mjs [sourceMap.js]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.argv[2] ?? path.join(ROOT, "R_Site/Build/mapbuilder/mymap/sourceMap.js");
const OUT = path.join(ROOT, "R_Site/Praser/js/module/model/normalize-map.json");

if (!fs.existsSync(SRC)) {
  process.stderr.write(`[-] map source not found: ${SRC}\n`);
  process.exit(1);
}

const mod = await import(`file://${path.resolve(SRC)}`);
for (const name of ["Priority", "Glue", "PUNCTUATION", "IMPOSTER"]) {
  if (mod[name] === undefined) {
    process.stderr.write(`[-] ${SRC} exports no ${name} — the map source moved?\n`);
    process.exit(1);
  }
}

const data = {
  _source: path.relative(ROOT, SRC),
  // char -> sort weight, kept as real characters so nothing is re-derived by hand.
  priority: Object.fromEntries(Object.entries(mod.Priority).map(([k, v]) => [k, v])),
  glue: [...mod.Glue],
  punctuation: [...mod.PUNCTUATION],
  // Object.values(IMPOSTER) order, flattened by the port exactly like cleanImposters
  // does (longest `from` first, stable) — so the sort rule stays visible in code.
  imposter: Object.values(mod.IMPOSTER).map((e) => ({ correct: e.correct, imposters: [...e.imposters] })),
};

fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + "\n", "utf8");
process.stdout.write(`[+] ${path.relative(ROOT, OUT)}: priority ${Object.keys(data.priority).length}, `
  + `glue ${data.glue.length}, punctuation ${data.punctuation.length}, `
  + `imposter families ${data.imposter.length}\n`);
const pri = Object.entries(data.priority).sort((a, b) => a[1] - b[1]).slice(-2);
process.stdout.write(`[+] last two priorities: ${pri.map(([c, n]) => `U+${c.codePointAt(0).toString(16).toUpperCase()}=${n}`).join(", ")}\n`);
