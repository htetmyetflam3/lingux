// FILE: _encode.js
import {
  normalizeStart, normalizeEnd, normFixImposter,
  normComposeNormal, normComposeNgaasat,
  debugLogInit, debugLogPass,
} from "../../../Bridge/logen.js";
import { isLowerOrUpperAZ } from "./_function.js";
import { PUNCTUATION, Priority, Glue, IMPOSTER } from "./sourceMap.js";
import { mapperStr } from "./sourceMapper.js";

debugLogInit();

export const ENGLISH_DIGITS = new Set(["0","1","2","3","4","5","6","7","8","9"]);
export const BURMESE_DIGITS = new Set(["၀","၁","၂","၃","၄","၅","၆","၇","၈","၉"]);
export const ALL_DIGITS = new Set([...ENGLISH_DIGITS, ...BURMESE_DIGITS]);

const cleanImposters = (t) => {
  // Placeholder: replaces imposter sequences with correct forms
  const reps = [];
  for (const entry of Object.values(IMPOSTER)) {
    for (const imp of entry.imposters) reps.push({ from: imp, to: entry.correct });
  }
  reps.sort((a, b) => b.from.length - a.from.length);
  for (const r of reps) t = t.split(r.from).join(r.to);
  return t;
};

const index = (ch) => {
  const cp = ch.codePointAt(0);
  return (cp >= 0x1000 && cp <= 0x1021) || cp === 0x1025 || cp === 0x1027;
};

const reorderString = (t) => {
  // Placeholder: reorders Myanmar diacritics by priority
  if (!t || typeof t !== "string") return "";
  const chars = Array.from(t);
  let out = "", i = 0;
  while (i < chars.length && !index(chars[i])) { out += chars[i]; i++; }
  while (i < chars.length) {
    const ch = chars[i];
    if (index(ch)) {
      out += ch; i++;
      const marks = [], seen = new Set();
      while (i < chars.length) {
        const next = chars[i];
        if (index(next)) break;
        const p = Priority[next];
        if (p === undefined) break;
        if (!seen.has(p)) { seen.add(p); marks.push(next); }
        i++;
      }
      if (marks.length) { marks.sort((a, b) => Priority[a] - Priority[b]); out += marks.join(""); }
    } else { out += ch; i++; }
  }
  return out;
};

function wrapEnglishBlocks(str) {
  // Placeholder: wraps contiguous English/digit blocks in braces
  const blockPunct = new Set([",", ".", ":", ";", "/", "(", ")", "-", "!", "?", " "]);
  const charType = (ch) => {
    if (isLowerOrUpperAZ(ch)) return "E";
    if (ENGLISH_DIGITS.has(ch)) return "L";
    if (BURMESE_DIGITS.has(ch)) return "B";
    if (blockPunct.has(ch)) return "P";
    return null;
  };
  let out = "", i = 0;
  while (i < str.length) {
    const startType = charType(str[i]);
    if (startType === "E" || startType === "L" || startType === "B") {
      let j = i;
      while (j < str.length) {
        const t = charType(str[j]);
        if (t === null || (t !== "P" && t !== startType)) break;
        j++;

      }
      const block = str.slice(i, j).replace(/ +/g, " ");
      const trimmed = block.replace(/ +$/, "");
      out += "{" + trimmed + "}" + block.slice(trimmed.length);
      i = j;
    } else { out += str[i]; i++; }
  }
  return out;
}

export function normalize(text, opts = {}) {
  // Placeholder: normalizes Myanmar text through NFC, strip, reorder, imposter fix, wrap
  if (!text || typeof text !== "string") return "";
  const { stripPunctuation = false, cleanMode = "gentle", log = false } = opts;
  let result = text;
  debugLogPass("0_INPUT", result);
  result = result.normalize("NFC");
  debugLogPass("1_NFC", result);
  const stripPunct = stripPunctuation || cleanMode === "aggressive";
  let cleaned = "";
  for (const ch of result) {
    if (Glue.has(ch)) continue;
    if (ch === "$" || ch === "#" || ch === "^" || ch === "{" || ch === "}" || ch === "√") continue;
    if (stripPunct && PUNCTUATION.has(ch)) continue;
    cleaned += ch;
  }
  result = cleaned;
  debugLogPass("2_STRIP", result);
  result = reorderString(result);
  debugLogPass("3_REORDER", result);
  result = cleanImposters(result);
  debugLogPass("4_IMPOSTER", result);
  result = wrapEnglishBlocks(result);
  debugLogPass("5_WRAP", result);
  return result;
}

export { normalize as default };

export function MyNormalize(str) {
  // Placeholder: normalizes then maps to ASCII tokens
  if (!str || typeof str !== "string") return "";
  return mapperStr(normalize(str));
}

