#!/usr/bin/env node
/**
 * .bin/praser-rabbit-check.mjs — does an installed Rabbit implementation agree
 * with rabbit.py's embedded 118-rule table on real document text?
 *
 *   node .bin/praser-rabbit-check.mjs [trace.jsonl]
 *
 * Reads the Python trace (raw + base per page) and compares each candidate
 * converter's zg2uni(raw) against the Python base. Any mismatch is a port
 * blocker: the pipeline writes whatever Rabbit returns, straight to output.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// Resolve from the praser's own node_modules, wherever this script is run from.
const require = createRequire(new URL(`file://${process.cwd()}/R_Site/Praser/js/index.js`));
const TRACE = process.argv[2] ?? "/tmp/linga_ref/py_pdf.jsonl";
const NODE_DIR = "R_Site/Praser/js";
const rules = JSON.parse(
  fs.readFileSync(path.join(NODE_DIR, "module/model/zg2uni-rules.json"), "utf8"),
);

/** Reference implementation: the Python table, translated mechanically. */
function localZg2uni(text) {
  for (const r of rules) {
    const src = r.from.endsWith("$") && !r.from.endsWith("\\$")
      ? `${r.from.slice(0, -1)}(?=\n?$)`
      : r.from;
    const to = r.to.replace(/\$/g, "$$").replace(/\\(\d)/g, "$$$1");
    text = text.replace(new RegExp(src, "g"), to);
  }
  return text;
}

const candidates = { local: localZg2uni };
try {
  const R = require("rabbit-node");
  if (R && typeof R.zg2uni === "function") candidates["rabbit-node"] = (t) => R.zg2uni(t);
} catch (e) {
  console.log(`[i] rabbit-node not resolvable: ${e.code}`);
}

const rows = fs.readFileSync(TRACE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const tally = {};
const firstBad = {};
for (const name of Object.keys(candidates)) { tally[name] = { ok: 0, bad: 0 }; }

for (const row of rows) {
  const expected = row.cat === "ZAWGYI" ? row.base : row.raw; // pipeline only converts ZAWGYI
  for (const [name, fn] of Object.entries(candidates)) {
    let got;
    try { got = fn(row.raw); } catch (e) { got = `THREW ${e.message}`; }
    if (got === expected) tally[name].ok += 1;
    else {
      tally[name].bad += 1;
      if (!firstBad[name]) firstBad[name] = { page: row.idx + 1, expected, got };
    }
  }
}

console.log(`[+] pages compared: ${rows.length}`);
for (const [name, t] of Object.entries(tally)) {
  console.log(`  ${name.padEnd(12)} match=${t.ok}  mismatch=${t.bad}`);
}
for (const [name, b] of Object.entries(firstBad)) {
  const e = b.expected.split("\n")[0].slice(0, 60);
  const g = String(b.got).split("\n")[0].slice(0, 60);
  console.log(`\n[!] ${name} first mismatch on page ${b.page}\n    python: ${JSON.stringify(e)}\n    ${name}: ${JSON.stringify(g)}`);
}
process.exit(Object.values(tally).some((t) => t.bad > 0) && Object.keys(tally).length > 1 ? 1 : 0);
