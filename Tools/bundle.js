
// FILE: _decode.js

import { toBurmeseStr } from './sourceMapper.js';

export function formatResolvedLine(lineResult) {
  const parts = [];
  for (const token of lineResult.tokens) {
    const ids = token.joinedIds ?? token.ids.join('');
    const pos = token.finalPos ?? '?';
    parts.push(`${ids}{${pos}}`);
  }
  if (lineResult.isEos) {
    parts.push('<EOS>  {eos}');
  }
  return parts.join('  ');
}

/**
 * Writes resolved lines from a generator to a stream writer.
 * DOES NOT close the writer — caller closes after all batches.
 */
export async function writeResolved(ruleGen, writer) {
  for await (const lineResult of ruleGen) {
    const line = formatResolvedLine(lineResult);
    writer.writeLine([line]);
  }
  writer.flush();
  // DO NOT close here — batch loop reuses the same writer
}

export function makeReadable(syllables) {
  const joined = syllables.join('  ');
  let out = toBurmeseStr(joined);
  out = out.replace(/[{}]/g, '');
  return out;
}

import fs from 'fs';

export function getBatchSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB < 1) return Infinity;
    if (sizeMB < 2) return 300;
    if (sizeMB < 5) return 500;
    return 1000;
  } catch {
    return 1000;
  }
}


// FILE: _encode.js
import {
	// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
	normalizeStart,
	// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
	normalizeEnd,
	// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
	normFixImposter,
	// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
	normComposeNormal,
	// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
	normComposeNgaasat,
	debugLogInit,
	debugLogPass,
} from "../../../Private/Bridge/logen.js";
import { isLowerOrUpperAZ } from "./_function.js";
import {
	PUNCTUATION,
	Priority,
	Glue,
	IMPOSTER,
} from "./sourceMap.js";
import { mapperStr } from "./sourceMapper.js";

debugLogInit();

export const ENGLISH_DIGITS = new Set(["0","1","2","3","4","5","6","7","8","9"]);
export const BURMESE_DIGITS = new Set(["၀","၁","၂","၃","၄","၅","၆","၇","၈","၉"]);
export const ALL_DIGITS = new Set([...ENGLISH_DIGITS, ...BURMESE_DIGITS]);

const cleanImposters = (t) => {
	const reps = [];
	for (const entry of Object.values(IMPOSTER)) {
		for (const imp of entry.imposters) {
			reps.push({ from: imp, to: entry.correct });
		}
	}
	reps.sort((a, b) => b.from.length - a.from.length);
	let tmp = t;
	for (const r of reps) tmp = tmp.split(r.from).join(r.to);
	return tmp;
};

const index = (ch) => {
	const cp = ch.codePointAt(0);
	return (
		(cp >= 0x1000 && cp <= 0x1021) || cp === 0x1025 || cp === 0x1027
	);
};

const reorderString = (t) => {
	if (!t || typeof t !== "string") return "";
	const chars = Array.from(t);
	let out = "";
	let i = 0;
	while (i < chars.length && !index(chars[i])) {
		out += chars[i];
		i++;
	}
	while (i < chars.length) {
		const ch = chars[i];
		if (index(ch)) {
			out += ch;
			i++;
			const marks = [];
			const seen = new Set();
			while (i < chars.length) {
				const next = chars[i];
				if (index(next)) break;
				const p = Priority[next];
				if (p === undefined) break;
				if (!seen.has(p)) {
					seen.add(p);
					marks.push(next);
				}
				i++;
			}
			if (marks.length) {
				marks.sort((a, b) => Priority[a] - Priority[b]);
				out += marks.join("");
			}
		} else {
			out += ch;
			i++;
		}
	}
	return out;
};

function wrapEnglishBlocks(str) {
	const blockPunct = new Set([",", ".", ":", ";", "/", "(", ")", "-", "!", "?", " "]);

	function charType(ch) {
		if (isLowerOrUpperAZ(ch)) return "E";
		if (ENGLISH_DIGITS.has(ch)) return "L";
		if (BURMESE_DIGITS.has(ch)) return "B";
		if (blockPunct.has(ch)) return "P";
		return null;
	}

	let out = "";
	let i = 0;
	while (i < str.length) {
		const ch = str[i];
		const startType = charType(ch);
		if (startType === "E" || startType === "L" || startType === "B") {
			let j = i;
			while (j < str.length) {
				const c = str[j];
				const t = charType(c);
				if (t === null) break;
				if (t === "P") { j++; continue; }
				if (t === startType) { j++; continue; }
				break;
			}
			/* Trailing spaces belong BETWEEN tokens, not inside one.
			   Leaving them in produced "{hello }" → a token "hello "
			   whose trailing space became a 3-space delimiter and a
			   leading-space syllable downstream. */
			const block = str.slice(i, j).replace(/ +/g, " ");
			const trimmed = block.replace(/ +$/, "");
			out += "{" + trimmed + "}" + block.slice(trimmed.length);
			i = j;
		} else {
			out += ch;
			i++;
		}
	}
	return out;
}

export function normalize(text, opts = {}) {
	if (!text || typeof text !== "string") return "";
	const {
		stripPunctuation = false,
		cleanMode = "gentle",
		// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
		log = false,
	} = opts;
	let result = text;
	debugLogPass("0_INPUT", result);
	result = result.normalize("NFC");
	debugLogPass("1_NFC", result);
	const stripPunct = stripPunctuation || cleanMode === "aggressive";
	let cleaned = "";
	for (const ch of result) {
		if (Glue.has(ch)) continue;
		/* √ is the token delimiter (bridge.js join / tagger.js split) — strip
		   it on the way in so input text can never collide with it. */
		if (ch === "$" || ch === "#" || ch === "^" || ch === "{" || ch === "}" || ch === "√")
			continue;
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
	if (!str || typeof str !== "string") return "";
	const cleaned = normalize(str);
	return mapperStr(cleaned);
}


// FILE: _function.js
import { MMap, NewMap } from './sourceMap.js';
const LOWER_A = 'a'.charCodeAt(0);
const LOWER_Z = 'z'.charCodeAt(0);
const UPPER_A = 'A'.charCodeAt(0);
const UPPER_Z = 'Z'.charCodeAt(0);
export function isLowerOrUpperAZ(char) {
  if (typeof char !== 'string' || char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= LOWER_A && code <= LOWER_Z) || (code >= UPPER_A && code <= UPPER_Z)
  );
}
export function isLowercaseAZ(char) {
  if (typeof char !== 'string' || char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return code >= LOWER_A && code <= LOWER_Z;
}
export function isUppercaseAZ(char) {
  if (typeof char !== 'string' || char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return code >= UPPER_A && code <= UPPER_Z;
}
const MYANMAR_BASE = /[\u1000-\u1021\u1025\u1027\u103F]/;
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
function isMyanmarBase(char) {
  return MYANMAR_BASE.test(char);
}
export function compose(str, asciiToMm) {
  const baseSet = new Set(NewMap.Base);
  return str.replace(
    /([A-Z])\^\$|\$([A-Z])|\$([a-z])|\$([^A-Za-z])|([A-Z])\^/g,
    (match, upperE, upperDollar, lowerDollar, otherDollar, upper) => {
      if (upperE) {
        return upperE + '#';
      }
      if (upperDollar) {
        const asc = upperDollar;
        if (baseSet.has(asc)) {
          return asciiToMm.get(asc) ?? match;
        }
        return match;
      }
      if (lowerDollar) {
        const asc = lowerDollar;
        if (baseSet.has(asc)) {
          return asciiToMm.get(asc) ?? match;
        }
        return match;
      }
      if (otherDollar) {
        const asc = otherDollar;
        if (baseSet.has(asc)) {
          return asciiToMm.get(asc) ?? match;
        }
        return match;
      }
      if (upper) {
        return String.fromCharCode(upper.charCodeAt(0) + 32);
      }
      return match;
    },
  );
}
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
export function decompose(str, mmToAscii, asciiToMm) {
  const myanmarBaseSet = new Set(MMap.Base);
  return withBraceBypass(str, (ch) => {
    if (ch === '#') return '^$';
    if (isLowercaseAZ(ch)) {
      return String.fromCharCode(ch.charCodeAt(0) - 32) + '^';
    }
    if (myanmarBaseSet.has(ch)) {
      return '\u1039' + ch;
    }
    return ch;
  });
}
/**
 * Maps a single Myanmar token to its ASCII equivalent.
 * @param {string} token - Single Myanmar character.
 * @param {Map} mmToAscii - Myanmar→ASCII mapping table.
 * @returns {string|null} ASCII token or null if not mapped.
 */
export function burmeseTokenToAscii(token, mmToAscii) {
  return mmToAscii.get(token) ?? null;
}
/**
 * Maps a single ASCII token to its Myanmar equivalent.
 * @param {string} token - Single ASCII token.
 * @param {Map} asciiToMm - ASCII→Myanmar mapping table.
 * @returns {string|null} Myanmar character or null if not mapped.
 */
export function asciiTokenToBurmese(token, asciiToMm) {
  return asciiToMm.get(token) ?? null;
}
/**
 * Pass-through with brace bypass.
 * Applies transformFn only to characters outside { } braces.
 * Content inside braces is preserved as-is.
 *
 * @param {string} str - Input string.
 * @param {Function} transformFn - Called with (char, index) for each char outside braces.
 * @returns {string} Transformed string with braces preserved.
 */
export function withBraceBypass(str, transformFn) {
  let out = '';
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '{') {
      const endBrace = str.indexOf('}', i + 1);
      if (endBrace !== -1) {
        out += str.slice(i, endBrace + 1); 
        i = endBrace + 1;
        continue;
      }
      out += ch;
      i++;
      continue;
    }
    if (ch === '}') {
      out += ch;
      i++;
      continue;
    }
    out += transformFn(ch, i);
    i++;
  }
  return out;
}

// FILE: idmapper.js
import fs from 'fs';
import path from 'path';
import { TreeFile } from '../../../Private/Bridge/path.js';

let _asciiToId = null;
let _idToAscii = null;
let _burmeseToId = null;
let _idToBurmese = null;

function loadMappings() {
  if (_asciiToId) return;

  _asciiToId = new Map();
  _idToAscii = new Map();
  _burmeseToId = new Map();
  _idToBurmese = new Map();

  const mapPath = path.join(TreeFile(), 'syllable.mapped.txt');
  if (!fs.existsSync(mapPath)) {
    console.warn(`[syllableToID] Not found: ${mapPath}`);
    return;
  }

  const content = fs.readFileSync(mapPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed
      .split(':')
      .map(p => p.trim().replace(/^["']|["']$/g, ''));

    if (parts.length < 3) continue;

    const [burmese, ascii, id] = parts;

    if (ascii && id) {
      _asciiToId.set(ascii, id);
      _idToAscii.set(id, ascii);
    }
    if (burmese && id) {
      _burmeseToId.set(burmese, id);
      _idToBurmese.set(id, burmese);
    }
  }

  console.log(
    `[syllableToID] Loaded ` +
    `${_asciiToId.size} ascii→id, ` +
    `${_idToBurmese.size} id→burmese`
  );
}

export function asciiToId(syllable) {
  if (!syllable) return null;
  loadMappings();
  return _asciiToId.get(syllable) ?? null;
}

export function burmeseToId(syllable) {
  if (!syllable) return null;
  loadMappings();
  return _burmeseToId.get(syllable) ?? null;
}

export function idToBurmese(id) {
  if (!id) return null;
  loadMappings();
  return _idToBurmese.get(id) ?? null;
}

export function idToAscii(id) {
  if (!id) return null;
  loadMappings();
  return _idToAscii.get(id) ?? null;
}

export function resetIdLookup() {
  _asciiToId = null;
  _idToAscii = null;
  _burmeseToId = null;
  _idToBurmese = null;
}


// FILE: sourceMap.js
/**
 * map.js — Myanmar character mappings.
 *
 * Encoding scheme:
 *   - Uppercase A-X     : Base consonants
 *   - Lowercase a-x     : Base + Asat (runtime combined)
 *   - Extended ASCII    : Remaining base chars (ဧ, ဩ, ဿ, ဣ, ဦ, ဥ, etc.)
 *   - Symbols           : Tails, Asat, Stick, standalone
 *   - Digits 0-9        : Myanmar numerals
 */
const MMap = {
  Base: [
    'က',
    'ခ',
    'ဂ',
    'ဃ',
    'င',
    'စ',
    'ဇ',
    'ည',
    'ဋ',
    'ဉ',
    'ဍ',
    'ဏ',
    'တ',
    'ထ',
    'ဒ',
    'န',
    'ပ',
    'ဖ',
    'ဗ',
    'ဘ',
    'မ',
    'ယ',
    'ရ',
    'လ',
    'သ',
    'ဟ',
    'အ',
    'ဥ',
    'ဧ',
    'ဈ',
    'ဝ',
    'ဓ',
    'ဩ',
    'ဿ',
    'ဣ',
    'ဦ',
    'ဠ',
    'ဌ',
    'ဆ',
    'ဎ',
    'ဪ',
    '၎',
  ],
  Tail: [
    '\u103B',
    '\u103C',
    '\u103D',
    '\u103E',
    '\u1031',
    '\u102D',
    '\u102E',
    '\u102F',
    '\u1030',
    '\u1032',
    '\u102C',
    '\u102B',
    '\u1036',
    '\u1037',
    '\u1038',
    '\u1039', 
  ],
  Asat: ['\u103A'],
  Num: ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'],
};
const NewMap = {
  Base: [
    'A',
    'B',
    'C',
    'D',
    'E',
    'F',
    'G',
    'H',
    'I',
    'J',
    'K',
    'L',
    'M',
    'N',
    'O',
    'P',
    'Q',
    'R',
    'S',
    'T',
    'U',
    'V',
    'W',
    'X',
    'Y',
    'Z',
    '¶',
    '£',
    '¥',
    '¦',
    '§',
    '¨',
    '©',
    'ª',
    '«',
    '¬',
    '®',
    '¯',
    '°',
    '±',
    '²',
    '³',
  ],
  Tail: [
    '*', 
    '¢', 
    '¤', 
    'µ', 
    '∆', 
    'Ð', 
    'Þ', 
    'ð', 
    'þ', 
    'ß', 
    '¼', 
    '½', 
    '¾', 
    '¿', 
    '_', 
    '$', 
  ],
  Asat: ['^'], 
  Num: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
};
const newClause = {
  stick: ['၊', '။', '/'],
  standalone: ['၍', '၌', '၏', 'ဤ', 'ဪ', '၎င်း', 'ဦး'],
};
const PUNCTUATION = new Set([
  ',',
  '.',
  "'",
  '/',
  '+',
  '-',
  '=',
  '%',
  '÷',
  '×',
  '(',
  ')',
  '[',
  ']',
  '@',
  '&',
  ';',
  '!',
  '?',
]);
const Priority = {
  '\u103B': 1,
  '\u103C': 2,
  '\u103D': 3,
  '\u103E': 4,
  '\u1031': 5,
  '\u102D': 6,
  '\u102E': 7,
  '\u102F': 8,
  '\u1030': 9,
  '\u1032': 10,
  '\u102C': 11,
  '\u102B': 12,
  '\u1036': 13,
  '\u103A': 14,
  '\u1037': 15,
  '\u1038': 16,
  '\u0020': 17,
  '\u000A': 18,
};
const Glue = new Set([
  '\u200B',
  '\u200C',
  '\u200D',
  '\u2060',
  '\uFEFF',
  '\u180E',
  '\u200E',
  '\u200F',
  '\u202A',
  '\u202B',
  '\u25CC',
  '\u00A0',
  '\u034F',
]);
const IMPOSTER = {
  '\u1023': { correct: '\u1023', imposters: ['\u1000\u1039\u1000'] },
  '\u102E\u1038': {
    correct: '\u102E\u1038',
    imposters: ['\u102E\u102D\u1038', '\u102D\u102E\u1038'],
  },
  '\u103F': { correct: '\u103F', imposters: ['\u101E\u1039\u101E'] },
  '\u1029': { correct: '\u1029', imposters: ['\u101E\u103C'] },
  '\u102A': {
    correct: '\u102A',
    imposters: ['\u101E\u103C\u1031\u103A', '\u1029\u103C\u1031\u103A'],
  },
  '\u104E\u1004\u103A\u1038': {
    correct: '\u104E\u1004\u103A\u1038',
    imposters: ['\u1044\u1004\u103A\u1038'],
  },
  '\u1009\u102C\u100B\u103A': {
    correct: '\u1009\u102C\u100B\u103A',
    imposters: ['\u1025\u102C\u100B\u103A', '\u1009\u102C\u100B\u103A'],
  },
  '\u1026\u1038': {
    correct: '\u1026\u1038',
    imposters: [
      '\u1025\u102E\u1038',
      '\u1025\u102D\u102E\u1038',
      '\u1009\u102E\u1038',
      '\u1009\u102D\u102E\u1038',
    ],
  },
  '\u1025\u102F\u1036': {
    correct: '\u1025\u102F\u1036',
    imposters: ['\u1009\u102F\u1036'],
  },
  '\u1025\u1019\u103A': {
    correct: '\u1025\u1019\u103A',
    imposters: ['\u1009\u1019\u103A'],
  },
};
export { MMap, NewMap, newClause, PUNCTUATION, Glue, IMPOSTER, Priority };

// FILE: sourceMapper.js
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
import { MMap, NewMap, newClause, PUNCTUATION } from "./sourceMap.js";
import {
	compose,
	decompose,
	burmeseTokenToAscii,
	asciiTokenToBurmese,
} from "./_function.js";
const _mmToAscii = new Map();
const _asciiToMm = new Map();
function _pair(mmArr, ascArr) {
	mmArr.forEach((mm, i) => {
		_mmToAscii.set(mm, ascArr[i]);
		_asciiToMm.set(ascArr[i], mm);
	});
}
_pair(MMap.Base, NewMap.Base);
_pair(MMap.Tail, NewMap.Tail);
_pair(MMap.Asat, NewMap.Asat);
_pair(MMap.Num, NewMap.Num);
function* iterate(str) {
	let i = 0;
	while (i < str.length) {
		const ch = str[i];
		if (ch === "{") {
			const end = str.indexOf("}", i + 1);
			if (end !== -1) {
				yield { type: "bypass", content: str.slice(i, end + 1) };
				i = end + 1;
				continue;
			}
		}
		yield { type: "token", char: ch, index: i };
		i++;
	}
}
export function mapperStr(str) {
	let out = "";
	for (const item of iterate(str)) {
		if (item.type === "bypass") {
			out += item.content;
		} else {
			out += burmeseTokenToAscii(item.char, _mmToAscii) ?? item.char;
		}
	}
	out = compose(out, _asciiToMm);
	return out;
}
export function toBurmeseStr(str) {
	const decomposed = decompose(str, _mmToAscii, _asciiToMm);
	let mm = "";
	for (const item of iterate(decomposed)) {
		if (item.type === "bypass") {
			mm += item.content;
		} else {
			mm += asciiTokenToBurmese(item.char, _asciiToMm) ?? item.char;
		}
	}
	return mm.replace(/[{}]/g, "");
}
const _tailLookup = {};
for (const tok of NewMap.Tail) {
	_tailLookup[tok] = "Mark";
}
_tailLookup[NewMap.Asat[0]] = "asat";
for (let i = 0; i < 26; i++) {
	_tailLookup[String.fromCharCode(97 + i)] = "baseasat";
}
export function isTail(tok) {
	return _tailLookup[tok] ?? false;
}
export function isBase(tok) {
	return NewMap.Base.includes(tok);
}
export function isNum(tok) {
	return NewMap.Num.includes(tok);
}
export function isStick(tok) {
	return newClause.stick.includes(tok);
}
export function isStandalone(tok) {
	return newClause.standalone.includes(tok);
}
