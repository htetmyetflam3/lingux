#!/usr/bin/env node
/**
 * Which rule fires on a given string — for BOTH converters, side by side.
 *
 *   node .bin/praser-rule-trace.mjs "အာရဗ ၻ"
 *   node .bin/praser-rule-trace.mjs                    # defaults to the misc.spec case
 *
 * `table`    = the praser's own 118 rules (module/model/zg2uni-rules.json), walked with
 *              the SAME loop `rabbit.mjs` uses, and asserted equal to `Rabbit.zg2uni`.
 * `official` = @myanmartools/zawgyi-unicode-translit-rules + @dagonmetric/translit-js,
 *              phase by phase (translit's own trace flag), so you can see WHICH PHASE
 *              changes the text and which one the praser's table simply does not have.
 *
 * The official packages are verification-only (installed with --no-save into
 * R_Site/Praser/js/node_modules); nothing in the praser imports them.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NM = path.join(ROOT, "R_Site", "Praser", "Node", "node_modules");
const require = createRequire(path.join(NM, "noop.js"));
const pkgDir = (n) => path.dirname(require.resolve(`${n}/package.json`));

const { Rabbit, initRabbit } = await import(path.join(ROOT, "R_Site/Praser/js/module/rabbit.mjs"));
await initRabbit();

const CASE = "\u1021\u102c\u101b\u1017\u0020\u107b";   // အာရဗ + space + Zawgyi U+107B (kinzi BA)
const text = process.argv[2] ?? CASE;

const cps = (s) => [...s].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`).join(" ");

// ── the praser's table ─────────────────────────────────────────────────────
// Mirrors rabbit.mjs exactly: adaptSource + pyReplToJs + a global replace per rule.
const pyReplToJs = (to) => to.replace(/\$/g, "$$").replace(/\\(\d)/g, "$$$1");
const adaptSource = (src) => (src.endsWith("$") && !src.endsWith("\\$") ? `${src.slice(0, -1)}(?=\n?$)` : src);
const rules = JSON.parse(fs.readFileSync(
  path.join(ROOT, "R_Site/Praser/js/module/model/zg2uni-rules.json"), "utf8"));

let out = text;
const fired = [];
for (let i = 0; i < rules.length; i += 1) {
  const rx = new RegExp(adaptSource(rules[i].from), "gu");
  const to = pyReplToJs(rules[i].to);
  const next = out.replace(rx, to);
  if (next !== out) { fired.push([i, rules[i].from, rules[i].to, out, next]); out = next; }
}
console.log(`input   ${JSON.stringify(text)}\n        ${cps(text)}\n`);
console.log("── praser table (118 rules, applied in order, each seeing the last one's output)");
for (const [i, from, to, before, after] of fired) {
  console.log(`[rule ${i}]  ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
  console.log(`   before ${JSON.stringify(before)}`);
  console.log(`   after  ${JSON.stringify(after)}`);
  console.log(`   cps    ${cps(after)}`);
}
console.log(`   fired rules: ${fired.map(([i]) => i).join(", ") || "(none)"}`);
console.log(`result  ${JSON.stringify(out)}\n        ${cps(out)}`);
console.log(`engine  ${JSON.stringify(Rabbit.zg2uni(text))}  `
  + `${out === Rabbit.zg2uni(text) ? "trace == Rabbit.zg2uni" : "TRACE DIFFERS FROM ENGINE"}`);
// The rule that matters here, stated plainly: it fires, and it is not a space rule.
const kinzi = rules.findIndex((r) => r.from.includes("107") || /ၻ|႓/.test(r.from));
console.log(`note    the only rule that can touch U+107B is [${kinzi}] `
  + `${JSON.stringify(rules[kinzi]?.from)} -> ${JSON.stringify(rules[kinzi]?.to)}: it replaces the`
  + ` single Zawgyi char and never looks at what sits in front of it. `
  + `Rules mentioning a space: ${rules.map((r, i) => [i, r]).filter(([, r]) => r.from.includes(" ")).map(([i, r]) => `${i}:${JSON.stringify(r.from)}`).join(" ")}`);

// ── the official converter, phase by phase ─────────────────────────────────
let engine, official;
try {
  ({ translit: engine } = await import(path.join(pkgDir("@dagonmetric/translit-js"), "fesm2015/translit-js.js")));
  ({ zg2uniRules: official } = await import(path.join(pkgDir("@myanmartools/zawgyi-unicode-translit-rules"), "src/zg2uni-rules.js")));
} catch (e) {
  console.log(`\n── official converter: skipped (${e.message})\n   npm install --no-save --prefix R_Site/Praser/js`
    + " @myanmartools/zawgyi-unicode-translit-rules @dagonmetric/translit-js");
  process.exit(0);
}

console.log("\n── official converter (@myanmartools/zawgyi-unicode-translit-rules), phase by phase");
let cur = text;
for (const phase of official.phases) {
  const r = engine(cur, [phase], undefined, true);
  const changed = r.outputText !== cur;
  console.log(`\nphase "${phase.description}"  ${changed ? "CHANGED the text" : "no change"}`);
  for (const t of (r.traces ?? [])) {
    console.log(`   from ${JSON.stringify(t.from)}\n     to ${JSON.stringify(t.to)}`);
    console.log(`   matched   ${JSON.stringify(t.matchedString)}  (${cps(t.matchedString)})`);
    console.log(`   replaced  ${JSON.stringify(t.replacedString)}  (${cps(t.replacedString)})`);
  }
  cur = r.outputText;
  if (changed) console.log(`   -> ${JSON.stringify(cur)}`);
}
const whole = engine(text, official).outputText;
console.log(`\nsum of phases ${JSON.stringify(cur)}\nall at once     ${JSON.stringify(whole)}  `
  + `${cur === whole ? "(same)" : "(differ: a phase's when/skip depends on options)"}`);
console.log(`official result ${cps(whole)}`);
console.log(`table result    ${cps(out)}`);
console.log(`difference      ${whole === out ? "none"
  : whole.length === out.length ? "same length, mark order only" : `length ${whole.length} vs ${out.length}`}`);
