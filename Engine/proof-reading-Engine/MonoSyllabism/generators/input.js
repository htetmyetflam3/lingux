import { collector } from '../utilities/stream.js';
import {
  normalize,
  mapperStr,
  isLowerOrUpperAZ,
  BLOCK_PUNCT,
  ENGLISH_DIGITS,
  BURMESE_DIGITS,
} from '../map/loader.js';
import { InputFile } from '../../Bridge/path.js';

/**
 * Generator: raw file → normalize → mask Latin/digit blocks → mapperStr.
 * Yields mapped blocks ready for the segmentor.
 * NOT file writing — belongs to object (memory/mapping).
 *
 * Why not mapperNormalize(): that composite is normalize → reorderAndWrap →
 * mapperStr, and reorderAndWrap re-sorts combining marks by mapData.Priority.
 * Priority puts asat (14) before dot-below (15), so a syllable arriving in
 * the engine's own order (asat, dot) is left alone, but the NFC pass inside
 * normalize() has already emitted (dot, asat) — reorder then flips it back,
 * and mapperStr/compose encodes those two orders differently:
 *
 *     mapperStr("သင့်" NFC order)  → "YE¿^"   ← the shape the POS tree holds
 *     mapperStr("သင့်" reordered)  → "Ye¿"    ← `E^` collapses to lowercase `e`
 *
 * The tree is built with MyNormalize(), which never reorders, so every
 * segmentor lookup of a reordered syllable misses and the walker emits one
 * mark per token. Verified: chapters 1–2 drop from 5.34% / 5.78% to
 * 3.10% / 2.72% mark-fragments once the reorder step is skipped.
 *
 * Reorder is therefore not used here. Its other job — wrapping Latin and
 * digit runs in `{…}` so mapperStr() bypasses them (mapperStr maps A–Z onto
 * Burmese bases, turning "Hello" into ညင်) — is done below instead.
 * The mark order this engine keeps is the order normalize() produces.
 */

/** One code unit's role in a Latin/digit block, mirroring reorderAndWrap(). */
function blockType(ch) {
  if (isLowerOrUpperAZ(ch)) return 'E';
  if (BLOCK_PUNCT.has(ch)) return 'P';
  if (ENGLISH_DIGITS.has(ch)) return 'L';
  if (BURMESE_DIGITS.has(ch)) return 'B';
  return null;
}

/**
 * Wrap runs of one block type in braces. Punctuation may interrupt a run, the
 * way reorderAndWrap() allowed it; trailing spaces stay outside the braces so
 * they remain the delimiters between tokens, not part of one.
 */
function maskBlocks(text) {
  const chars = Array.from(text);
  let out = '';
  let i = 0;

  while (i < chars.length) {
    const start = blockType(chars[i]);
    if (start === 'E' || start === 'L' || start === 'B') {
      let j = i;
      while (j < chars.length) {
        const type = blockType(chars[j]);
        if (type === null) break;
        if (type === 'P' || type === start) {
          j++;
          continue;
        }
        break;
      }
      const raw = chars.slice(i, j).join('').replace(/ +/g, ' ');
      const trimmed = raw.replace(/ +$/, '');
      out += '{' + trimmed + '}' + raw.slice(trimmed.length);
      i = j;
      continue;
    }
    out += chars[i];
    i++;
  }

  return out;
}

export async function* readAndPrepare(inputFile = InputFile()) {
  for await (const block of collector(inputFile)) {
    yield mapperStr(maskBlocks(normalize(block)));
  }
}
