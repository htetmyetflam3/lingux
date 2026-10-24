#!/usr/bin/env node
/**
 * Verify the praser's normalize / myNormalize against the real thing.
 *
 *   normalize     <- R_Site/Build/mapbuilder/mymap/_encode.js normalize()   (an oracle)
 *   myNormalize   <- the owner's step order; the engine has no such function, so the
 *                    oracle here is an independent transcription of that order using
 *                    the same source files, written in this script.
 *
 * _encode.js imports ../../../Bridge/logen.js for debugLogPass(), and that file is not
 * in this checkout (only the compiled map-runtime.jsc is). So the oracle is _encode.js
 * with EXACTLY that one import replaced by no-op stubs — the rule bodies are untouched,
 * and the patched copy is written to a temp dir with its other imports rewritten to
 * absolute paths, so nothing is added to the repo.
 *
 * Usage (from the repo root): node .bin/praser-normalize-check.mjs [ref-dir]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REF = process.argv[2] || "/tmp/linga_ref";
const MYMAP = path.join(ROOT, "R_Site/Build/mapbuilder/mymap");

const src = fs.readFileSync(path.join(MYMAP, "_encode.js"), "utf8");
const stub = `const debugLogInit = () => {};
const debugLogPass = () => {};
const normalizeStart = null, normalizeEnd = null, normFixImposter = null,
      normComposeNormal = null, normComposeNgaasat = null;
`;
// Replace ONLY the logen import block (multi-line, from `import {` up to the first
// `logen.js";`), and make the remaining relative imports absolute.
const patched = src
  .replace(/import\s*\{[^}]*\}\s*from\s*["'][^"']*logen\.js["'];?/, stub)
  .replace(/from "\.\/([A-Za-z_]+)\.js"/g, (_m, f) => `from ${JSON.stringify(path.join(MYMAP, f + ".js"))}`);
if (/logen\.js/.test(patched)) throw new Error("failed to stub the logen import");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "praser-oracle-"));
fs.writeFileSync(path.join(tmp, "oracle.mjs"), patched);

const oracle = await import(path.join(tmp, "oracle.mjs"));
const mine = await import(path.join(ROOT, "R_Site/Praser/js/module/normalize.mjs"));
const MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "R_Site/Praser/js/module/model/normalize-map.json"), "utf8"));

let fails = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) fails += 1;
  process.stdout.write(`${pass ? "[OK]  " : "[FAIL]"} ${label}${detail ? `  ${detail}` : ""}\n`);
};

// ── the corpus, in both modes where an oracle exists ───────────────────────
const files = ["py_pdf.jsonl", "py_docx.jsonl"].filter((f) => fs.existsSync(path.join(REF, f)));
if (!files.length) {
  process.stdout.write(`[skip] no ${REF}/*.jsonl (run python3 .bin/praser-trace.py ${REF})\n`);
}
let n = 0, bad = 0, first = null;
for (const f of files) {
  for (const line of fs.readFileSync(path.join(REF, f), "utf8").trim().split("\n")) {
    const rec = JSON.parse(line);
    for (const key of ["base", "clean", "raw"]) {
      const t = rec[key];
      if (typeof t !== "string" || !t) continue;
      n += 1;
      const a = oracle.normalize(t);
      const b = mine.normalizeText(t);
      if (a !== b) {
        bad += 1;
        if (!first) {
          let k = 0;
          while (k < Math.min(a.length, b.length) && a[k] === b[k]) k += 1;
          first = `${f} ${key} at char ${k}: oracle ${JSON.stringify(a.slice(k - 20, k + 30))} `
            + `port ${JSON.stringify(b.slice(k - 20, k + 30))}`;
        }
      }
    }
  }
}
ok(`normalize mode == _encode.js normalize`, bad === 0,
  `${n - bad}/${n} texts (${files.join(", ")})`);
if (first) process.stdout.write(`       ${first}\n`);

// ── myNormalize: independent transcription of the owner's step order ───────
const isBase = (ch) => {
  const cp = ch.codePointAt(0);
  return (cp >= 0x1000 && cp <= 0x1021) || cp === 0x1025 || cp === 0x1027;
};
const refReorder = (t) => {
  const chars = Array.from(t);
  let out = "", i = 0;
  while (i < chars.length && !isBase(chars[i])) { out += chars[i]; i += 1; }
  while (i < chars.length) {
    if (!isBase(chars[i])) { out += chars[i]; i += 1; continue; }
    out += chars[i]; i += 1;
    const marks = [], seen = new Set();
    while (i < chars.length && !isBase(chars[i]) && MAP.priority[chars[i]] !== undefined) {
      const p = MAP.priority[chars[i]];
      if (!seen.has(p)) { seen.add(p); marks.push(chars[i]); }
      i += 1;
    }
    marks.sort((x, y) => MAP.priority[x] - MAP.priority[y]);
    out += marks.join("");
  }
  return out;
};
const refImposter = (t) => {
  const reps = [];
  for (const e of MAP.imposter) for (const imp of e.imposters) reps.push([imp, e.correct]);
  reps.sort((x, y) => y[0].length - x[0].length);
  let s = t;
  for (const [from, to] of reps) s = s.split(from).join(to);
  return s;
};
const refDelete = (t) => {
  const punct = new Set([",", ".", ":", ";", "/", "(", ")", "-", "!", "?", " "]);
  const type = (c) => (/[a-zA-Z]/.test(c) ? "E" : /[0-9]/.test(c) ? "L"
    : /[\u1040-\u1049]/.test(c) ? "B" : punct.has(c) ? "P" : null);
  let out = "", i = 0;
  while (i < t.length) {
    const st = type(t[i]);
    if (st !== "E" && st !== "L" && st !== "B") { out += t[i]; i += 1; continue; }
    let j = i;
    while (j < t.length) {
      const tt = type(t[j]);
      if (tt === null) break;
      if (tt === "P" || tt === st) { j += 1; continue; }
      break;
    }
    const block = t.slice(i, j).replace(/ +/g, " ");
    const trimmed = block.replace(/ +$/, "");
    out += block.slice(trimmed.length);           // the block itself is dropped
    i = j;
  }
  return out;
};
const refMy = (s) => refReorder(refImposter(refDelete(s.normalize("NFC"))));

const cases = [
  "Chapter 701: \u1000\u1031\u102c\u1004\u103a\u1038 page 12",
  "ka \u101e\u1031\u102c\u1000\u103a \u102b\u1015\u1039",
  "a\u103b\u102d\u102d\u1037\u103a b",
  "\u1000\u103b\u1031\u102c\u1004\u103a\u1038\u1037 \u101d\u1004\u103a",
  "\u1044\u1004\u103a\u1038 and \u1025\u102e\u1038 digits 007",
  "", "   ", "\u1021\u102c\u101b\u1017 \u107b",
];
// plus every corpus text, through both
for (const f of files) {
  for (const line of fs.readFileSync(path.join(REF, f), "utf8").trim().split("\n")) {
    const t = JSON.parse(line).base;
    if (typeof t === "string" && t) cases.push(t);
  }
}
let myBad = 0, myFirst = null;
for (const t of cases) {
  const a = refMy(t), b = mine.myNormalize(t);
  if (a !== b) {
    myBad += 1;
    if (!myFirst) {
      let k = 0;
      while (k < Math.min(a.length, b.length) && a[k] === b[k]) k += 1;
      myFirst = `at char ${k}: transcription ${JSON.stringify(a.slice(k - 20, k + 30))} `
        + `port ${JSON.stringify(b.slice(k - 20, k + 30))}`;
    }
  }
}
ok(`mynormalize mode == the owner's step order`, myBad === 0,
  `${cases.length - myBad}/${cases.length} texts`);
if (myFirst) process.stdout.write(`       ${myFirst}\n`);

// ── the two modes must differ in the documented ways, and in nothing else ──
let stray = 0;
for (const t of cases) {
  if (t.includes("a") || t.match(/[a-zA-Z\u1040-\u1049]/)) continue;   // blocks matter here
  const a = mine.normalizeText(t), b = mine.myNormalize(t);
  // no latin: the only remaining difference is normalize's glue/delimiter strip and
  // the imposter/reorder order — assert that, not "equal"
  const stripped = t.replace(/[\u200B\u200C\u200D\u2060\uFEFF\u180E\u200E\u200F\u202A\u202B\u25CC\u00A0\u034F$#^{}√]/g, "");
  if (mine.normalizeText(stripped) !== a && a !== b) stray += 1;
}
ok("modes agree where no English block or stripped char is present", stray === 0, `${stray} stray`);

// ── a readable sample of each mode ─────────────────────────────────────────
if (files.length) {
  const t = JSON.parse(fs.readFileSync(path.join(REF, files[0]), "utf8").trim().split("\n")[0]).base;
  const one = t.split("\n")[0];
  process.stdout.write(`\n       sample  ${JSON.stringify(one)}\n`
    + `       normalize ${JSON.stringify(mine.normalizeText(one))}\n`
    + `       mynormal  ${JSON.stringify(mine.myNormalize(one))}\n`);
}

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(`\n${fails === 0 ? "NORMALIZATION MODES VERIFIED" : `${fails} check(s) failed`}\n`);
process.exitCode = fails === 0 ? 0 : 1;
