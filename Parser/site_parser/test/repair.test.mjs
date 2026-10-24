import test from "node:test";
import assert from "node:assert/strict";
import {
  HOMOGLYPH_PAIRS, homoglyphVariants, repairToken, repairHomoglyphs,
} from "../text/repair.mjs";

const words = new Set(["စဉ်", "အစဉ်", "လုံးဝ", "ဝဂ်", "ယာဉ်", "ရေ"]);

test("the three legacy homoglyph pairs are loaded", () => {
  assert.equal(HOMOGLYPH_PAIRS.length, 3);
  assert.deepEqual(HOMOGLYPH_PAIRS[0], ["\u101D", "\u1040"]); // ဝ / ၀
  assert.deepEqual(HOMOGLYPH_PAIRS[1], ["\u101B", "\u1047"]); // ရ / ၇
  assert.deepEqual(HOMOGLYPH_PAIRS[2], ["\u1009", "\u1025"]); // ဉ / ဥ
});

test("variants swap in both directions and never include the input", () => {
  const v = homoglyphVariants("စဥ်");
  assert.ok(v.includes("စဉ်"), "ဥ -> ဉ");
  assert.ok(!v.includes("စဥ်"), "input excluded");
  assert.ok(homoglyphVariants("လုံး\u1040").includes("လုံးဝ"), "၀ -> ဝ");
  assert.ok(homoglyphVariants("လုံးဝ").includes("လုံး\u1040"), "ဝ -> ၀, reverse");
});

test("a token already in the dictionary is never touched", () => {
  assert.equal(repairToken("စဉ်", words), null);
  assert.equal(repairToken("လုံးဝ", words), null);
});

test("a single resolving variant is the repair", () => {
  assert.equal(repairToken("စဥ်", words), "စဉ်");
  assert.equal(repairToken("အစဥ်", words), "အစဉ်");
  assert.equal(repairToken("လုံး\u1040", words), "လုံးဝ");
});

test("a token with no resolving variant is left alone", () => {
  assert.equal(repairToken("ကကကက", words), null);
  assert.equal(repairToken("စဥ်ကကက", words), null);
});

test("ambiguity changes nothing", () => {
  // both swaps land on a word, so neither may be chosen
  const ambiguous = new Set(["ကဝခ", "က\u1040ခ"]);
  assert.equal(repairToken("ကဝခ", ambiguous), null);
});

test("an empty or missing dictionary is a no-op", () => {
  assert.equal(repairToken("စဥ်", new Set()), null);
  assert.equal(repairToken("စဥ်", null), null);
  assert.deepEqual(repairHomoglyphs("စဥ်", new Set()).repairs, []);
});

test("whole-text repair rewrites and tallies", () => {
  const { text, repairs } = repairHomoglyphs("အစဥ် နှင့် စဥ် နှင့် စဥ်", words);
  assert.equal(text, "အစဉ် နှင့် စဉ် နှင့် စဉ်");
  const total = repairs.reduce((n, r) => n + r.count, 0);
  assert.equal(total, 3);
  assert.equal(repairs[0].from, "စဥ်");
  assert.equal(repairs[0].to, "စဉ်");
  assert.equal(repairs[0].count, 2);
});

test("non-Myanmar text passes through untouched", () => {
  const src = "Chapter 7: hello world 2024";
  assert.equal(repairHomoglyphs(src, words).text, src);
});

// ---------------------------------------------------------------- glued numbers
import { splitGluedNumber, repairText } from "../text/repair.mjs";

const toc = new Set(["သဒ္ဒါ", "ဝဂ်", "မျိုး", "စဉ်"]);

test("a trailing page number is split off a heading", () => {
  assert.deepEqual(splitGluedNumber("သဒ္ဒါ\u1041", toc), ["သဒ္ဒါ", "\u1041"]);
  assert.deepEqual(splitGluedNumber("ဝဂ်\u1043\u1048", toc), ["ဝဂ်", "\u1043\u1048"]);
});

test("a leading list marker is split off a heading", () => {
  assert.deepEqual(splitGluedNumber("\u1041\u104Bသဒ္ဒါ", toc), null, "။ is not part of the digit run");
  assert.deepEqual(splitGluedNumber("\u1041သဒ္ဒါ", toc), ["\u1041", "သဒ္ဒါ"]);
});

test("a token already in the dictionary is never split", () => {
  assert.equal(splitGluedNumber("သဒ္ဒါ", toc), null);
});

test("a split that leaves a non-word is refused", () => {
  assert.equal(splitGluedNumber("ကကက\u1041", toc), null);
  assert.equal(splitGluedNumber("\u1041\u1042\u1043", toc), null, "all digits, nothing left");
});

test("ambiguity at both ends changes nothing", () => {
  const both = new Set(["ကခ", "ဂဃ"]);
  assert.equal(splitGluedNumber("\u1041ကခ\u1042", both), null);
});

test("repairText applies swaps and splits together", () => {
  const words = new Set(["စဉ်", "သဒ္ဒါ"]);
  const { text, repairs, splits } = repairText("စဥ် သဒ္ဒါ\u1041", words);
  assert.equal(text, "စဉ် သဒ္ဒါ \u1041");
  assert.equal(repairs.reduce((n, r) => n + r.count, 0), 1);
  assert.equal(splits.reduce((n, r) => n + r.count, 0), 1);
});

test("repairText is a no-op without a dictionary", () => {
  assert.equal(repairText("သဒ္ဒါ\u1041", new Set()).text, "သဒ္ဒါ\u1041");
});
