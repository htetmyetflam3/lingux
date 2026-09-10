import {
	taggerStart,
	taggerEnd,
	tagTokenReceived,
	tagWordCount,
} from "../../../Bridge/logen.js";

import { walkPos } from "../grapheme/traverser.js";
import { PUNCTUATION, ALL_DIGITS } from "../../mapper/map/map-loader.js";
import { burmeseToId } from "../../mapper/map/idmapper.js";

const BURMESE_FULLSTOP = "။";

function isWhitespace(tok) {
	return tok === " " || tok === "\t" || tok === "\r" || tok === "\n";
}

function isNumber(tok) {
	if (!tok) return false;
	let hasDigit = false;
	for (const ch of tok) {
		if (ALL_DIGITS.has(ch)) {
			hasDigit = true;
			continue;
		}
		if (ch === " " || ch === "-" || ch === "/" || ch === "." || ch === ",") continue;
		return false;
	}
	return hasDigit;
}

/* Years worth recognising: Burmese era and Gregorian. A bare 4-digit
   number outside these is a quantity, not a year — which is what keeps
   "1500 ကျပ်" a count. Edit these two rows to widen or narrow it. */
const YEAR_RANGES = [
	[1200, 1400], // Burmese era (current is ~1386)
	[1900, 2100], // Gregorian
];

const DATE_SEP = /[.\-/]/;

/** Digit groups, separator-agnostic. "2024.12.25" → ["2024","12","25"] */
function numGroups(tok) {
	return tok.split(/[.\-/,]/).filter((g) => g.length > 0);
}

function toArabic(s) {
	return Number(s.replace(/[၀-၉]/g, (d) => "၀၁၂၃၄၅၆၇၈၉".indexOf(d)));
}

function isYear(s) {
	if (!/^[0-9၀-၉]{4}$/.test(s)) return false;
	const n = toArabic(s);
	return YEAR_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

function classifyNumber(tok) {
	const t = tok.trim();
	const digitsOnly = t.replace(/[^0-9၀-၉]/g, "");

	/* phone first — most specific shape */
	if (/^(၀၉|09)/.test(digitsOnly) && digitsOnly.length >= 8 && digitsOnly.length <= 11) {
		return { rawPos: ["phone"] };
	}

	const groups = numGroups(t);
	const allNumeric = groups.every((g) => /^[0-9၀-၉]+$/.test(g));

	/* three numeric groups joined by . - / is a date: 2024.12.25, 25/12/2024 */
	if (allNumeric && groups.length === 3 && DATE_SEP.test(t)) {
		return { rawPos: ["exactdate"] };
	}

	/* a lone 4-digit group in a year range: 2024, ၁၃၈၆ */
	if (allNumeric && groups.length === 1 && isYear(groups[0])) {
		return { rawPos: ["year"] };
	}

	/* "၁၂၃/" — a slash that is not part of a date is still an address */
	if (t.includes("/")) {
		return { rawPos: ["addr"] };
	}

	return { rawPos: ["count"] };
}

function isPunctuation(tok) {
	return PUNCTUATION.has(tok);
}

function isEnglishBlock(tok) {
	return tok && tok.startsWith("{") && tok.endsWith("}");
}

function isTreeId(id) {
	if (!id || id.length !== 4) return false;
	/* No /^\d{4}$/ branch: ids were 4 numeric digits in the old scheme
	   (1500/1000 were literal standalones). They are prefix + 3 digits
	   now, standalones have π, so a bare 4-digit id cannot occur — the
	   branch could only ever collide with a caller's own number. */
	if (/^[A-Z¶£¥¦§¨©ª«¬®¯°±²³]\d{3}$/.test(id)) return true;
	if (/^π\d{3}$/.test(id)) return true;
	return false;
}

function classifyToken(tok) {
	if (isWhitespace(tok)) return null;
	if (isNumber(tok)) return classifyNumber(tok);
	if (tok === BURMESE_FULLSTOP) return { rawPos: ["pan"] };
	if (isPunctuation(tok)) return { rawPos: ["pan"] };
	if (isEnglishBlock(tok)) return { rawPos: ["en"] };
	return { rawPos: ["?"] };
}

function* walkLine(burmeseTokens, idTokens) {
	let pos = 0;

	while (pos < idTokens.length) {
		const burmeseTok = burmeseTokens[pos];
		const idTok = idTokens[pos];

		/* Fullstop never walks the tree — skip it and inject the
		   boundary token (same early-out shape as the skips below). */
		if (burmeseTok === BURMESE_FULLSTOP) {
			yield {
				syllables: ["<eos>"],
				ids: [idTok],
				rawPos: ["eos"],
			};
			pos++;
			continue;
		}

		if (!isTreeId(idTok)) {
			const classified = classifyToken(burmeseTok);
			if (classified) {
				yield {
					syllables: [burmeseTok],
					ids: [idTok],
					rawPos: classified.rawPos,
				};
			}
			pos++;
			continue;
		}

		const result = walkPos(idTokens, pos);
		if (!result) {
			pos++;
			continue;
		}

		const nextPos = result.lastValidPos;
		const consumedBurmese = burmeseTokens.slice(pos, nextPos);
		const consumedIds = idTokens.slice(pos, nextPos);

		if (consumedBurmese.length > 0) {
			yield {
				syllables: consumedBurmese,
				ids: [consumedIds.join("")],
				rawPos: result.rawPos,
			};
		}
		pos = nextPos;
	}
}

export async function* runTagger(unitGen, hash) {
	taggerStart({ hash });

	const startTime = Date.now();
	let tokenCount = 0;
	let wordCount = 0;

	for await (const lineStr of unitGen) {
		const burmeseTokens = lineStr.split("√").filter((t) => t);
		const idTokens = burmeseTokens.map((t) => burmeseToId(t) ?? t);

		const lastTok = burmeseTokens[burmeseTokens.length - 1];
		const hasFullStop = lastTok === BURMESE_FULLSTOP;

		const lineTokens = [];
		for (const token of walkLine(burmeseTokens, idTokens)) {
			lineTokens.push(token);
			tokenCount++;
			const tag = token.rawPos[0];
			if (
				tag !== "?" &&
				tag !== "pan" &&
				tag !== "eos" &&
				tag !== "en" &&
				tag !== "count" &&
				tag !== "phone" &&
				tag !== "addr" &&
				tag !== "year" &&
				tag !== "exactdate"
			) {
				wordCount++;
			}
		}

		yield {
			tokens: lineTokens,
			isEos: hasFullStop,
		};
	}

	tagTokenReceived(tokenCount);
	tagWordCount(wordCount);

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	taggerEnd({ tokenCount, wordCount, elapsedSec: elapsed });
}

export default { runTagger };
