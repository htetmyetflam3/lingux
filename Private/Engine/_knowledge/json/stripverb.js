/*
 * Description: Cleans master.json by extracting သည်-ending verbs from
 *   dictionary.VERB, classifying them, and modifying master.json in place.
 *   Keeps non-သည် words in dictionary.VERB untouched.
 *   Pure verbs (stripped) replace extracted ones in dictionary.VERB.
 *   Rejected verbs that hit NOUN rules go to dictionary.RBNV and are
 *   scrubbed from dictionary.NOUN. Rejected by other rules are deleted.
 *   Does NOT touch PARTICLE, ADVERB, WIBAT, CONJUNCTION, or other arrays.
 *   Reads: ./master.json
 *   Outputs: ./master.json (modified), ./output/verb-analysis.json (reference)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const MASTER_FILE = resolve(process.cwd(), "master.json");
const OUT_DIR = resolve(process.cwd(), "output");
const VERB_ANALYSIS_FILE = resolve(OUT_DIR, "verb-analysis.json");

mkdirSync(OUT_DIR, { recursive: true });

// ── helpers ──
function norm(w) {
  return typeof w === "string" ? w.replace(/ /g, "").replace(/\u00A0/g, "") : "";
}

function stripသည်(w) {
  return w.replace(/\s*သည်\s*$/, "");
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

// ── load ──
const raw = readFileSync(MASTER_FILE, "utf8");
const data = JSON.parse(raw);
const dict = data.dictionary || {};
const top = data.top || {};
const resolution = data.resolution || {};

// ═══════════════════════════════════════════════════════════════════════════
// STEP 1: Extract သည်-ending verbs from dictionary.VERB only
// ═══════════════════════════════════════════════════════════════════════════
const SUFFIX_RE = /သည်$/;
const verbArr = dict.VERB || [];

const extractedVerbs = [];
const untouchedVerbs = [];

for (const w of verbArr) {
  if (typeof w === "string" && SUFFIX_RE.test(w.trim())) {
    extractedVerbs.push(w);
  } else {
    untouchedVerbs.push(w);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 2: Build lookup sets
// ═══════════════════════════════════════════════════════════════════════════

// --- 2a. Particle maps ---
const topParticle2Syl = new Set();
for (const w of collectStrings(top.particle || {})) {
  if (typeof w === "string" && w.trim().endsWith("သည်")) topParticle2Syl.add(w.trim());
}

const resParticle2Syl = new Set();
for (const w of collectStrings(resolution)) {
  if (typeof w === "string" && w.trim().endsWith("သည်")) resParticle2Syl.add(w.trim());
}

const dictParticle2Syl = new Map();
for (const cat of ["WIBAT", "PARTICLE", "CONJUNCTION"]) {
  const arr = dict[cat];
  if (Array.isArray(arr)) {
    dictParticle2Syl.set(
      cat,
      new Set(arr.filter((x) => typeof x === "string" && x.trim().endsWith("သည်")).map((x) => x.trim()))
    );
  }
}

// --- 2b. Noun/Adj/Adv sets ---
const dictSets = {};
for (const [cat, arr] of Object.entries(dict)) {
  if (cat === "VERB" || !Array.isArray(arr)) continue;
  dictSets[cat] = new Set(arr.map(norm));
}

// --- 2c. Noun blacklist from ORIGINAL dictionary.NOUN ---
const nounBlacklist = new Set();
const nounArr = dict.NOUN || [];
for (const w of nounArr) {
  if (typeof w === "string" && w.trim().endsWith("သည်")) {
    const stripped = stripသည်(w);
    if (stripped) nounBlacklist.add(norm(stripped));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 3: Classify extracted verbs
// ═══════════════════════════════════════════════════════════════════════════
const pureVerbs = [];
const nounRejected = [];   // → RBNV
const otherRejected = [];  // → deleted entirely

for (const w of extractedVerbs) {
  const extractedForm = w.trim();
  if (!extractedForm.endsWith("သည်")) continue;

  const strippedForm = stripသည်(w);
  if (!strippedForm) continue;

  const hits = [];

  // Rule A: particle-map check
  if (topParticle2Syl.has(extractedForm)) hits.push("top.particle");
  if (resParticle2Syl.has(extractedForm)) hits.push("resolution");
  for (const [cat, set] of dictParticle2Syl) {
    if (set.has(extractedForm)) hits.push(`dict.${cat}`);
  }

  // Rule B: noun/adj/adv/blacklist check
  const sNorm = norm(strippedForm);
  if (dictSets.NOUN?.has(sNorm)) hits.push("dict.NOUN");
  if (dictSets.ADJECTIVE?.has(sNorm)) hits.push("dict.ADJECTIVE");
  if (dictSets.ADVERB?.has(sNorm)) hits.push("dict.ADVERB");
  if (nounBlacklist.has(sNorm)) hits.push("nounBlacklist");

  if (hits.length === 0) {
    pureVerbs.push({ raw: w, stripped: strippedForm });
  } else if (hits.some((h) => h === "dict.NOUN" || h === "nounBlacklist")) {
    // Ambiguous verb/noun boundary → RBNV
    nounRejected.push({ raw: w, stripped: strippedForm, hits });
  } else {
    // Rejected by other rules → delete entirely
    otherRejected.push({ raw: w, stripped: strippedForm, hits });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 4: Remove noun-ambiguous words from dictionary.NOUN
// ═══════════════════════════════════════════════════════════════════════════
const rejectedNounNorms = new Set();
for (const v of nounRejected) {
  rejectedNounNorms.add(norm(v.stripped));
}

let removedFromNoun = 0;
if (dict.NOUN && rejectedNounNorms.size > 0) {
  dict.NOUN = dict.NOUN.filter((w) => {
    if (typeof w !== "string") return true;
    const wNorm = norm(w);
    const wStrippedNorm = norm(stripသည်(w));
    if (rejectedNounNorms.has(wNorm) || rejectedNounNorms.has(wStrippedNorm)) {
      removedFromNoun++;
      return false;
    }
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 5: Build dictionary.VERB and dictionary.RBNV
// ═══════════════════════════════════════════════════════════════════════════

dict.VERB = [
  ...untouchedVerbs,
  ...pureVerbs.map((v) => v.stripped),
];

dict.RBNV = nounRejected.map((v) => v.stripped);

// Save master.json
writeFileSync(MASTER_FILE, JSON.stringify(data, null, 2));

// ═══════════════════════════════════════════════════════════════════════════
// STEP 6: Write verb-analysis.json
// ═══════════════════════════════════════════════════════════════════════════
const verbAnalysis = {
  meta: {
    source: MASTER_FILE,
    generated: new Date().toISOString(),
  },
  counts: {
    originalVerbArray: verbArr.length,
    untouchedInVerb: untouchedVerbs.length,
    extractedWithသည်: extractedVerbs.length,
    pure: pureVerbs.length,
    nounRejected: nounRejected.length,
    otherRejected: otherRejected.length,
    removedFromNoun: removedFromNoun,
    finalVerbArray: dict.VERB.length,
    finalNounArray: (dict.NOUN || []).length,
    rbnvArray: dict.RBNV.length,
  },
  pure: {
    words: pureVerbs.map((v) => v.stripped),
  },
  nounRejected: {
    words: nounRejected.map((v) => v.stripped),
    details: nounRejected.map((v) => ({
      raw: v.raw,
      stripped: v.stripped,
      hits: v.hits,
    })),
  },
  otherRejected: {
    words: otherRejected.map((v) => v.stripped),
    details: otherRejected.map((v) => ({
      raw: v.raw,
      stripped: v.stripped,
      hits: v.hits,
    })),
  },
};

writeFileSync(VERB_ANALYSIS_FILE, JSON.stringify(verbAnalysis, null, 2));

// ── console report ──
console.log("=== Master.json Clean Complete ===");
console.log(`Original dictionary.VERB:     ${verbArr.length}`);
console.log(`  Untouched (no သည်):         ${untouchedVerbs.length}`);
console.log(`  Extracted (with သည်):       ${extractedVerbs.length}`);
console.log(`    → Pure (kept in VERB):    ${pureVerbs.length}`);
console.log(`    → Noun-ambiguous (→ RBNV): ${nounRejected.length}`);
console.log(`    → Other-rejected (deleted): ${otherRejected.length}`);
console.log(`Removed from dictionary.NOUN: ${removedFromNoun}`);
console.log(`Final dictionary.VERB:        ${dict.VERB.length}`);
console.log(`Final dictionary.NOUN:        ${(dict.NOUN || []).length}`);
console.log(`New dictionary.RBNV:          ${dict.RBNV.length}`);
console.log("");
console.log(`Modified: ${MASTER_FILE}`);
console.log(`Reference: ${VERB_ANALYSIS_FILE}`);
