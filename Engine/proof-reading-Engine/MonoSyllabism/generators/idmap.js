/**
 * idmap.js — the ASCII↔Burmes↔ID converter tables.
 *
 * Moved from MonoSyllabism/map/base/idmapper.js (map/base/ deleted: the map
 * dir holds only generated artifacts now). Loads once, lazily, from
 * File/.tree/syllable.mapped.txt written by the build phase. Row parsing
 * goes through Tree.loaded.loadMappedRows — the single home for that file.
 */

import { TreeFile } from "../../Bridge/path.js";
import { loadMappedRows } from "../main/grapheme/Tree.loaded.js";

let _asciiToId = null;
let _idToAscii = null;
let _burmeseToId = null;
let _idToBurmese = null;

/* One key per syllable, whatever order the dot/asat pair arrived in.
   The mapped table stores the house order (asat then dot, U+103A U+1037);
   the encoder hands back the NFC order (U+1037 U+103A). Without this the id
   lookup misses and the tagger prints {?} on a syllable it just matched. */
const NFC_DOT_ASAT = /\u1037\u103a/g;
function key(surface) {
	return typeof surface === "string" ? surface.replace(NFC_DOT_ASAT, "\u103a\u1037") : surface;
}

function loadMappings() {
	if (_asciiToId) return;

	_asciiToId = new Map();
	_idToAscii = new Map();
	_burmeseToId = new Map();
	_idToBurmese = new Map();

	const rows = loadMappedRows(TreeFile());
	if (!rows) {
		console.warn(`[syllableToID] Not found: ${TreeFile()}/syllable.mapped.txt`);
		return;
	}

	for (const { burmese, ascii, id } of rows) {
		if (ascii && id) {
			_asciiToId.set(ascii, id);
			_idToAscii.set(id, ascii);
		}
		if (burmese && id) {
			_burmeseToId.set(key(burmese), id);
			_idToBurmese.set(id, burmese);
		}
	}

	console.log(
		`[syllableToID] Loaded ` +
		`${_asciiToId.size} ascii→id, ` +
		`${_idToBurmese.size} id→burmese`
	);
}

/** Burmese surface → tree id (null when unmapped). */
export function burmeseToId(syllable) {
	if (!syllable) return null;
	loadMappings();
	return _burmeseToId.get(key(syllable)) ?? null;
}

/** ASCII key-string → tree id (null when unmapped). */
export function asciiToId(ascii) {
	if (!ascii) return null;
	loadMappings();
	return _asciiToId.get(ascii) ?? null;
}

/** Tree id → Burmese surface (null when unknown). */
export function idToBurmese(id) {
	if (!id) return null;
	loadMappings();
	return _idToBurmese.get(id) ?? null;
}

/** Tree id → ASCII key-string (null when unknown). */
export function idToAscii(id) {
	if (!id) return null;
	loadMappings();
	return _idToAscii.get(id) ?? null;
}
