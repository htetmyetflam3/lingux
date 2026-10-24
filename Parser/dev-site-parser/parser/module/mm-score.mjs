/**
 * Port of mm_score.py — scores how much a decoded string reads like real
 * Burmese. Used to rank candidate legacy code pages (pdf_fonts.py's
 * LEGACY_CODE_PAGES) when more than one is registered. Never rewrites text.
 */

// The dependent marks: signs that cannot stand without a base in front of
// them. Space and newline are NOT marks (see MARK_ORDER).
export const MARKS = new Set(
  Array.from("\u103b\u103c\u103d\u103e\u1031\u102d\u102e\u102f\u1030\u1032\u102c\u102b\u1036\u103a\u1037\u1038")
    .map((c) => c.codePointAt(0)),
);

// THE priority table — verbatim from the grammar engine, the only one in
// this codebase (normalize.mjs's PRIORITY must never disagree with this).
export const MARK_ORDER = new Map([
  ["\u103b", 1], ["\u103c", 2], ["\u103d", 3], ["\u103e", 4], ["\u1031", 5],
  ["\u102d", 6], ["\u102e", 7], ["\u102f", 8], ["\u1030", 9], ["\u1032", 10],
  ["\u102c", 11], ["\u102b", 12], ["\u1036", 13], ["\u103a", 14], ["\u1037", 15],
  ["\u1038", 16], [" ", 17], ["\n", 18],
]);

export function isIndex(ch) {
  if (!ch) return false;
  const cp = ch.codePointAt(0);
  return (cp >= 0x1000 && cp <= 0x1021) || cp === 0x1025 || cp === 0x1027;
}

export function isMark(ch) {
  return !!ch && MARKS.has(ch.codePointAt(0));
}

export function isMyanmar(ch) {
  if (!ch) return false;
  const cp = ch.codePointAt(0);
  return cp >= 0x1000 && cp <= 0x109f;
}

export function myanmarRatio(text) {
  if (!text) return 0.0;
  const chars = Array.from(text);
  let n = 0;
  for (const ch of chars) if (isMyanmar(ch)) n += 1;
  return n / chars.length;
}

/** Yield {ch, attached, run} over text — attached is true where a mark would
 * be legal (right after a base, or after marks already bound to one). */
function* walk(text) {
  let attached = false;
  let run = [];
  for (const ch of text) {
    const mark = isMark(ch);
    yield { ch, attached, run };
    if (isIndex(ch)) {
      attached = true;
      run = [];
    } else if (mark) {
      if (attached) run.push(ch);
    } else {
      attached = false;
      run = [];
    }
  }
}

export function orphanMarkRate(text) {
  let total = 0;
  let bad = 0;
  for (const { ch, attached } of walk(text)) {
    if (isMark(ch)) {
      total += 1;
      if (!attached) bad += 1;
    }
  }
  return total ? bad / total : 0.0;
}

export function duplicateMarkRate(text) {
  let total = 0;
  let dup = 0;
  for (const { ch, attached, run } of walk(text)) {
    if (isMark(ch) && attached) {
      total += 1;
      if (run.includes(ch)) dup += 1;
    }
  }
  return total ? dup / total : 0.0;
}

export function orderViolationRate(text) {
  let pairs = 0;
  let bad = 0;
  let run = null;
  for (const ch of text) {
    if (isIndex(ch)) {
      run = [];
      continue;
    }
    if (MARKS.has(ch.codePointAt(0))) {
      if (run !== null) {
        run.push(ch);
        if (run.length > 1) {
          pairs += 1;
          if (MARK_ORDER.get(run[run.length - 2]) > MARK_ORDER.get(run[run.length - 1])) {
            bad += 1;
          }
        }
      }
      continue;
    }
    run = null;
  }
  return pairs ? bad / pairs : 0.0;
}

/** score_text(): {score, orphan, disorder, duplicate, marks, myanmarRatio}. */
export function scoreText(text) {
  const chars = Array.from(text);
  let marks = 0;
  for (const ch of chars) if (isMark(ch)) marks += 1;
  if (!marks) {
    return { score: 0.0, orphan: 0.0, disorder: 0.0, duplicate: 0.0, marks: 0, myanmarRatio: myanmarRatio(text) };
  }
  const orphan = orphanMarkRate(text);
  const disorder = orderViolationRate(text);
  return {
    score: 1.0 - Math.max(orphan, disorder),
    orphan,
    disorder,
    duplicate: duplicateMarkRate(text),
    marks,
    myanmarRatio: myanmarRatio(text),
  };
}
