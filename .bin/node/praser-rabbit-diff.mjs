#!/usr/bin/env node
/**
 * .bin/praser-rabbit-diff.mjs — compare the rule table of an installed Rabbit
 * package against the table embedded in rabbit.py, by (from,to) pair.
 *
 *   node .bin/praser-rabbit-diff.mjs
 *
 * Prints the rules the Python side has and the package does not (and vice
 * versa). Run from the repo root.
 */
import fs from "node:fs";

const src = fs.readFileSync(
  "R_Site/Praser/js/node_modules/rabbit-node/lib/rabbit.js", "utf8",
);
const seg = src.slice(src.indexOf("const zg2uni"), src.indexOf("const replace_with_rule"));
const re = /"from"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"to"\s*:\s*"((?:[^"\\]|\\.)*)"/gs;
const js = [];
let m;
while ((m = re.exec(seg)) !== null) {
  js.push({ from: JSON.parse(`"${m[1]}"`), to: JSON.parse(`"${m[2]}"`) });
}

const rules = JSON.parse(fs.readFileSync("R_Site/Praser/js/module/model/zg2uni-rules.json", "utf8"));

const key = (r) => `${r.from}\u0000${r.to}`;
const jsSet = new Map(js.map((r) => [key(r), r]));
const pySet = new Map(rules.map((r) => [key(r), r]));

const esc = (s) => [...s].map((c) => (c.codePointAt(0) > 0x2000 ? `\\u${c.codePointAt(0).toString(16).toUpperCase()}` : c)).join("");

console.log(`rabbit.py  : ${rules.length} rules`);
console.log(`rabbit-node: ${js.length} rules`);

const onlyPy = rules.filter((r) => !jsSet.has(key(r)));
const onlyJs = js.filter((r) => !pySet.has(key(r)));
console.log(`\nin python, NOT in rabbit-node (${onlyPy.length}):`);
for (const r of onlyPy) {
  console.log(`  #${rules.indexOf(r) + 1}  from=${JSON.stringify(esc(r.from))}  to=${JSON.stringify(esc(r.to))}`);
}
console.log(`\nin rabbit-node, NOT in python (${onlyJs.length}):`);
for (const r of onlyJs) console.log(`  from=${JSON.stringify(esc(r.from))}  to=${JSON.stringify(esc(r.to))}`);

// Position drift: same pair count would still allow reordering.
let drift = 0;
for (let i = 0; i < Math.min(rules.length, js.length); i += 1) if (key(rules[i]) !== key(js[i])) drift += 1;
console.log(`\npositionally misaligned in ${drift}/${Math.min(rules.length, js.length)} slots (table order matters).`);
