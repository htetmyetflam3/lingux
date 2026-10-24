#!/usr/bin/env node
/**
 * Is the praser's Rabbit table still a verbatim copy of upstream Rabbit's rule file?
 *
 *   git clone --depth 1 https://github.com/Rabbit-Converter/Rabbit.git /tmp/rabbit
 *   node .bin/praser-rabbit-source-check.mjs [path-to-rabbit-clone]
 *
 * `R_Site/Praser/Python/module/rabbit.py` documents itself as "the COMPLETE official
 * Rabbit zg2uni table (118 rules), copied verbatim from
 * rabbit-converter/rabbit source/rule/zg2uni.json - same rules, same order (order is
 * significant), JS $N replacement refs converted to Python \N". This checks that claim
 * position by position, and then checks the exported JSON the Node port reads, so a
 * drift in EITHER file is caught here rather than in a document.
 *
 * It also reports the rule files the praser does NOT ship. Rabbit is a two-stage tool —
 * `win2zg` (Windows keyboard-font text -> Zawgyi) then `zg2uni` — and the praser only
 * carries stage two, which is the right choice for a Zawgyi-encoded PDF and a silent
 * no-op for a Word-era Windows-encoded one (the Markov detector scores such a page as
 * UNICODE and it passes through untouched).
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RABBIT = process.argv[2] || "/tmp/rabbit";
const RULE_DIR = path.join(RABBIT, "source", "rule");

let bad = 0;
const say = (label, pass, detail = "") => {
  if (!pass) bad += 1;
  process.stdout.write(`${pass ? "[OK]  " : "[FAIL]"} ${label}${detail ? `  ${detail}` : ""}\n`);
};

if (!fs.existsSync(path.join(RULE_DIR, "zg2uni.json"))) {
  process.stdout.write(`[skip] no ${RULE_DIR}/zg2uni.json\n`
    + "       git clone --depth 1 https://github.com/Rabbit-Converter/Rabbit.git /tmp/rabbit\n");
  process.exitCode = 0;
} else {
  const up = JSON.parse(fs.readFileSync(path.join(RULE_DIR, "zg2uni.json"), "utf8"))
    .map((r) => ({ from: r.from, to: r.to }));
  const gen = JSON.parse(fs.readFileSync(
    path.join(ROOT, "R_Site/Praser/js/module/model/zg2uni-rules.json"), "utf8"));

  // rabbit.py's _RULES, parsed out of the source (it is the Python's only table).
  const pySrc = fs.readFileSync(
    path.join(ROOT, "R_Site/Praser/Python/module/rabbit.py"), "utf8");
  const body = pySrc.split("_RULES = [")[1].split("\n    ]")[0];
  const py = [...body.matchAll(/\{\s*"from":\s*u"([\s\S]*?)",\s*"to":\s*u"([\s\S]*?)"\s*\}/g)]
    .map((m) => ({ from: unesc(m[1]), to: unesc(m[2]) }));

  const toJs = (t) => t.replace(/\\(\d)/g, "$$$1");   // python \N backref -> js $1 (a literal $ plus the group)
  const compare = (name, ours) => {
    const fDiff = [], tDiff = [];
    for (let i = 0; i < Math.max(up.length, ours.length); i += 1) {
      if (!up[i] || !ours[i]) { (i >= ours.length ? fDiff : tDiff).push(i); continue; }
      if (up[i].from !== ours[i].from) fDiff.push(i);
      if (up[i].to !== toJs(ours[i].to)) tDiff.push(i);
    }
    say(`${name} == upstream zg2uni.json`,
      fDiff.length === 0 && tDiff.length === 0,
      `${ours.length}/${up.length} rules, same order`
      + (fDiff.length ? `, from-differs at [${fDiff.slice(0, 8)}]` : "")
      + (tDiff.length ? `, to-differs at [${tDiff.slice(0, 8)}]` : ""));
    for (const i of [...fDiff, ...tDiff].slice(0, 4)) {
      process.stdout.write(`       [${i}] upstream ${JSON.stringify(up[i])}\n`
        + `            ours     ${JSON.stringify(ours[i])}\n`);
    }
  };
  compare("rabbit.py _RULES ", py);
  compare("exported JSON    ", gen);
  process.stdout.write("\n");
}

/** Unescape a python u"..." body the way the interpreter would for this file's content. */
function unesc(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\\/g, "\\");
}

// ── what upstream ships that the praser does not ──────────────────────────
for (const f of ["uni2zg.json", "win2zg.json"]) {
  const p = path.join(RULE_DIR, f);
  if (!fs.existsSync(p)) { process.stdout.write(`[skip] upstream has no ${f}\n`); continue; }
  const n = JSON.parse(fs.readFileSync(p, "utf8")).length;
  const base = f.replace(/\.json$/, "");
  let refs = "";
  try {
    refs = execSync(`grep -rl ${base} R_Site R_Engine --include=\*.py --include=\*.js --include=\*.mjs`
      + ` --include=\*.json --include=\*.md 2>/dev/null | grep -v node_modules`
      + ` | grep -v praser-rabbit-source-check | head -5`, { cwd: ROOT, encoding: "utf8" });
  } catch { /* grep exits 1 on no match */ }
  process.stdout.write(`[i] upstream ${f}: ${n} rules — in the praser? ${refs.trim() ? refs.trim() : "NO reference anywhere in R_Site/R_Engine"}\n`);
}
process.stdout.write(`\n${bad === 0
  ? "The praser's table is the verbatim upstream rule set, in upstream order."
  : `${bad} drift check(s) failed.`}\n`);
process.exitCode = bad === 0 ? 0 : 1;
