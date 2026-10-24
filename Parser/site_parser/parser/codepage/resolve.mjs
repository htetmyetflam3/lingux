/**
 * FILE: Parsed/parser/codepage/resolve.mjs
 *
 * THE FRONT DOOR OF THE CODEPAGE LAYER. Nothing outside codepage/ calls
 * registry/names/vote directly -- it asks here, and gets one answer.
 *
 * A "code page" here is NOT page layout. It is one table:
 *
 *     byte code in the PDF content stream  ->  Myanmar text
 *
 * Legacy Burmese PDFs ship a font whose bytes mean whatever that foundry
 * decided, so the same byte is a different letter in every family. Picking the
 * wrong table is what turns readable Burmese into rubbish, so the choice is
 * made once, here, and scored.
 *
 * Two ways in, one way out:
 *
 *   prepareVectorLayout()  GATE + BUILD. Cheap PDF-structure check first: a
 *                          document with no legacy font never loads a specimen
 *                          sheet and never costs a pixel. Only if the gate
 *                          opens does codepage/vote.mjs build a candidate table
 *                          from the rendered page.
 *
 *   chooseCodePage()       SCORE + PICK. Every registered table (and the voted
 *                          candidate, if one was built) decodes the first few
 *                          pages; the Burmese score decides. A table that
 *                          produces fewer than 50 marks scores 0, so a lucky
 *                          short match cannot win.
 *
 * Both were inline in pipeline.mjs. Assembly should not also be deciding; that
 * is why they live here now. Logic is unchanged.
 */

import fs from "node:fs";

import { orderText } from "../text/normalize.mjs";
import { scoreText } from "../text/mm-score.mjs";
import {
  extractPageLines, parsePdfObjects, getStream, parseToUnicodeStream,
} from "../read/pdf-extract.mjs";
import { DocumentDecoding, detectLegacyLayoutFonts } from "../read/pdf-fonts.mjs";
import { LEGACY_CODE_PAGES, UNICODE_PATH } from "./registry.mjs";
import { buildVectorLegacyLayout } from "./vote.mjs";
import { emitEvent } from "../../../logen/core.js";

/* The score a code page must clear to be used at all. It belongs here, with
   the code that scores: pipeline.mjs held it and re-exports it, which made
   this layer unable to state its own threshold without importing upward. */
export const LEGACY_QUALITY_FLOOR = 0.85;

const CODE_PAGE_PROBE_PAGES = 6;

export function chooseCodePage(objects, allPages, legacyMap, codePages = LEGACY_CODE_PAGES, vectorLayout = null, unicodeStrategy = null) {
  const ranking = [];
  /* Ledger, filled in this function's own loop and emitted ONCE at the end.
     Two things here are silent and are what make a bad choice impossible to
     explain after the fact:
       - a candidate with fewer than 50 Myanmar marks is scored 0 whatever
         it actually produced, so "everything scored zero" can mean "the
         tables are wrong" OR "the sample was too short";
       - a page that throws during extraction is skipped with no trace, so
         the sample can quietly be a fraction of what was asked for. */
  const ledger = { candidates: 0, zeroedForFewMarks: 0, pagesAsked: 0, pagesUsed: 0, pagesFailed: 0, marks: 0 };

  /* One scorer, so the Unicode path and the legacy tables are judged by
     exactly the same thing. The 50-mark floor is part of the score, not a
     gate around it: a candidate that produced almost no Myanmar scores 0
     whatever it actually produced, so a lucky short match cannot win. */
  const scoreStrategy = (name, strategy) => {
    ledger.candidates += 1;
    const chunks = [];
    for (const [pnum, pgen] of allPages.slice(0, CODE_PAGE_PROBE_PAGES)) {
      ledger.pagesAsked += 1;
      let plines;
      try {
        [plines] = extractPageLines(objects, pnum, pgen, strategy);
      } catch {
        ledger.pagesFailed += 1;
        continue;
      }
      ledger.pagesUsed += 1;
      chunks.push(plines.map((x) => x[3]).join("\n"));
    }
    const sample = chunks.join("\n");
    const result = scoreText(orderText(sample));
    const zeroed = result.marks < 50;
    if (zeroed) ledger.zeroedForFewMarks += 1;
    ledger.marks = Math.max(ledger.marks, result.marks);
    ranking.push([name, zeroed ? 0.0 : result.score]);
  };

  for (const [name, table] of codePages) {
    scoreStrategy(name, new DocumentDecoding("legacy", legacyMap, table, {
      legacyFontNames: vectorLayout && name === vectorLayout.name
        ? [vectorLayout.fontName, ...(vectorLayout.sourceBaseFonts || [])]
        : null,
    }));
  }

  /* The UNICODE path, competing on the same score. This is the document
     reading as itself: the font's own embedded cmap, else its /ToUnicode.
     No legacyFontNames -- no foundry table is being applied, so the
     font-name restriction that steers a legacy table does not apply. */
  if (unicodeStrategy) scoreStrategy(UNICODE_PATH, unicodeStrategy);

  ranking.sort((a, b) => b[1] - a[1]);
  const [bestName, bestScore] = ranking[0];

  // One event, at the end. Nothing was emitted inside the loop.
  emitEvent('codepage', {
    ...ledger,
    chosen: bestName,
    score: bestScore,
    floor: LEGACY_QUALITY_FLOOR,
    accepted: bestScore >= LEGACY_QUALITY_FLOOR,
    ranking: ranking.map(([n, sc]) => `${n}=${sc.toFixed(3)}`),
  });

  return [codePages.get(bestName), bestName, bestScore, ranking];
}

/**
 * Build the optional raster->SVG legacy layout before the synchronous page
 * stream starts. The cheap PDF-structure gate means ordinary Unicode/Zawgyi
 * documents never load or parse the vector sheet.
 */
export async function prepareVectorLayout(source, log = () => {}) {
  const input = Buffer.isBuffer(source) || source instanceof Uint8Array
    ? (Buffer.isBuffer(source) ? source : Buffer.from(source))
    : fs.readFileSync(source);
  let objects;
  try {
    objects = parsePdfObjects(input);
  } catch {
    return null;
  }
  const legacyFonts = detectLegacyLayoutFonts(objects, getStream, parseToUnicodeStream);
  if (!legacyFonts.length) return null;
  return buildVectorLegacyLayout(input, LEGACY_CODE_PAGES, { objects, log });
}
