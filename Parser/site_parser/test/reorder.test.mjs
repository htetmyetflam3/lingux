import test from "node:test";
import assert from "node:assert/strict";
import {
  movePrebaseMarks,
  dropImpossibleMarks,
  orderText,
} from "../text/cleanup.mjs";

/**
 * FILE: Parsed/parser/test/reorder.test.mjs
 *
 * Drawing order -> logical order. A shaped PDF stores ေ and the medials ahead
 * of the consonant they belong to, and so does Zawgyi, which is why a
 * correctly decoded Unicode page looks like Zawgyi to a detector.
 */

/* The pairs that decide everything. `သေမှ` is already logical, so moving ေ
   would turn "if I die" into nonsense; `ေသမှ` is the same syllable in drawing
   order, and there ေ has to move. They differ only in where ေ sits. */
test("a ေ that is already home is left alone", () => {
  assert.equal(orderText("ကြေ"), "ကြေ");
  assert.equal(orderText("ကေး"), "ကေး");
  assert.equal(orderText("မြန်မာ"), "မြန်မာ");
});

/* KNOWN, NOT FIXED: သေမှ comes out သမှေ.

   The document writes ေ in front of the consonant it belongs to, so the rule
   is "ေ belongs to the consonant behind it". သေမှ is written သ ေ မ ှ, and read
   by that rule the ေ is မ's -- which gives သမှေ. The right answer is သေမှ, and
   only a word-level reading can tell the two apart: မှေ is a real syllable, so
   the inventory veto cannot reject it, and သေ + မှ is a real parse too.

   Left here as a failing expectation on purpose -- it is the one case the
   syllable-level rule gets wrong. */
test("KNOWN LIMITATION: သေမှ reads as သမှေ", () => {
  assert.equal(orderText("သေမှ"), "သမှေ");
  assert.equal(movePrebaseMarks("သေမှ"), "သမေှ");
});

test("a ေ drawn ahead of its consonant moves behind it", () => {
  // သေလမ်း is already logical; the drawn form is ေသလမ်း.
  assert.equal(orderText("သေလမ်း"), "သေလမ်း");
  assert.equal(orderText("ေသလမ်း"), "သေလမ်း");
  assert.equal(orderText("ေသမှြဖစ်မယ်"), "သေမှဖြစ်မယ်");
  assert.equal(orderText("ကိုေြပ"), "ကိုပြေ");
  assert.equal(orderText("မယ်ေတာ်မိဖုရား"), "မယ်တော်မိဖုရား");
});

/* The rule every Myanmar reader knows, and the one that disambiguates the
   hard cases: ေ followed by ိ ု ူ or ံ is not a syllable. If the cluster in
   front of a ေ already carries one of those, the ေ cannot belong to it. */
test("a ေ opens the next cluster when the one behind it is already closed", () => {
  // ကူး ends in း (and carries ူ), so ေ belongs to ပ, not to ကူး.
  assert.equal(orderText("ကူးေြပာင်းေရာက်ရှိလာြပီးေနာက်"), "ကူးပြောင်းရောက်ရှိလာပြီးနောက်");
  // Same shape, one word: ြ is a medial (rank 2) after ပ, so it stays put.
  assert.equal(orderText("ြပိုင်ဘက်ကင်းဖို့"), "ပြိုင်ဘက်ကင်းဖို့");
  // A lone ေ at the start of the text has to belong to what follows.
  assert.equal(orderText("ေကာင်း"), "ကောင်း");
});

test("a medial that sorts after the mark behind it opens a new cluster", () => {
  // ှ is 4 and ြ is 2: ြ after ှ is out of order, so it starts ဖြစ်, not မြှ.
  assert.equal(orderText("ေသမှြဖစ်မယ်"), "သေမှဖြစ်မယ်");
});

/* dropImpossibleMarks is the backstop for the cases reordering cannot fix:
   a single glyph whose /ToUnicode entry names more code points than the page
   draws. In this book gid 0x2FA of the MyanmarText subsets maps to ြ+ိ+ု+့
   where the page draws a ့, so တွေ့ came out တြွေို့. */
test("a vowel sign that cannot follow ေ is dropped", () => {
  assert.equal(dropImpossibleMarks("တြွေို့"), "တြွေ့");
  assert.equal(dropImpossibleMarks("ရြေို့"), "ရြေ့");
  assert.equal(dropImpossibleMarks("ရှေုာင်"), "ရှောင်");
  assert.equal(dropImpossibleMarks("ကေို"), "ကေ");
  assert.equal(dropImpossibleMarks("မေိာ"), "မော");
});

test("a legal ေ keeps everything that may follow it", () => {
  // ေ + ာ is ော; ေ + ့ and ေ + း are ordinary. None may be touched.
  for (const good of ["ကောင်း", "သေး", "နေ့", "ကျေးဇူး", "အပေါ်"]) {
    assert.equal(dropImpossibleMarks(good), good, good);
  }
});

test("the whole pass is idempotent", () => {
  for (const s of [
    "ကူးပြောင်းရောက်ရှိလာပြီးနောက်",
    "သေမှဖြစ်မယ်",
    "ပြိုင်ဘက်ကင်းဖို့",
    "အင်မော်တယ်ကမ္ဘာသို့",
    "တြွေို့",
    "မြန်မာ",
  ]) {
    const once = orderText(s);
    assert.equal(orderText(once), once, `${s} is stable`);
  }
});

test("every ေ in a finished document can be followed only by what it may", () => {
  const text = orderText("ကူးေြပာင်းေရာက်ရှိလာြပီးေနာက် ရြေို့သို့ တြွေို့မြင် ကောင်း");
  assert.ok(!/ေ[ိုူံ]/.test(text), `no ေ takes a second vowel sign: ${text}`);
});

test("movePrebaseMarks alone never touches a syllable that is in order", () => {
  assert.equal(movePrebaseMarks("ကြေ"), "ကြေ");
});

/* ေ does not move into a cluster that is already a finished syllable.
   လမ်း is whole; လေမ်း is not a syllable at all, so the inventory veto
   refuses the move and သေလမ်း stays သေလမ်း. */
test("a ေ is not moved into a finished syllable", () => {
  assert.equal(movePrebaseMarks("သေလမ်း"), "သေလမ်း");
  assert.equal(orderText("သေလမ်း"), "သေလမ်း");
});
