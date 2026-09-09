#!/usr/bin/env node
/**
 * obfuscate-map.js
 * Category: build
 *
 * Obfuscates the sensitive Myanmar character-mapping modules so other
 * engine modules import the obfuscated (read-protected) versions while the
 * pipeline keeps working.
 *
 * The four modules are the "map layer" that hides how Myanmar (Burmese)
 * characters are encoded / reordered / mapped to ASCII tokens:
 *   - sourceMap.js   (MMap, NewMap, newClause, PUNCTUATION, Glue, IMPOSTER, Priority)
 *   - sourceMapper.js(mapperStr, toBurmeseStr, isTail, isBase, isNum, isStick, isStandalone)
 *   - _encode.js     (normalize, MyNormalize, ENGLISH_DIGITS, BURMESE_DIGITS, ALL_DIGITS)
 *   - _decode.js     (formatResolvedLine, writeResolved, makeReadable, getBatchSize)
 *
 * NOTE: export names are preserved by javascript-obfuscator so named
 * bindings stay stable. This script never writes into the engine tree.
 *
 * Usage:
 *   node Tools/create/obfuscate-map.js --src <readable-map-dir> --out <output-dir>
 */

import fs from "node:fs";
import path from "node:path";
import JavaScriptObfuscator from "javascript-obfuscator";

const FILES = ["sourceMap.js", "sourceMapper.js", "_encode.js", "_decode.js"];

const OBFUSCATE_OPTS = {
	compact: true,
	controlFlowFlattening: true,
	deadCodeInjection: false,
	stringArray: true,
	stringArrayEncoding: ["base64"],
	stringArrayThreshold: 1.0,
	renameGlobals: false,
	identifierNamesGenerator: "hexadecimal",
	simplify: true,
	target: "node",
};

const argv = process.argv.slice(2);
const argValue = (name) => {
	const i = argv.indexOf(name);
	return i === -1 ? undefined : argv[i + 1];
};
const srcDir = argValue("--src");
const outDir = argValue("--out");
if (!srcDir || !outDir) {
	console.error("Usage: node Tools/create/obfuscate-map.js --src <readable-map-dir> --out <output-dir>");
	process.exit(1);
}

if (!fs.existsSync(srcDir)) {
	console.error(`Source directory not found: ${srcDir}`);
	process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

for (const file of FILES) {
	const src = path.join(srcDir, file);
	const dst = path.join(outDir, file);
	if (!fs.existsSync(src)) {
		console.warn(`  skip (missing) ${file}`);
		continue;
	}
	const original = fs.readFileSync(src, "utf8");
	const obfuscated = JavaScriptObfuscator.obfuscate(original, OBFUSCATE_OPTS).getObfuscatedCode();
	fs.writeFileSync(dst, obfuscated, "utf8");
	console.log(
		`  ${file}: ${(Buffer.byteLength(original) / 1024).toFixed(2)} KB -> ${(
			Buffer.byteLength(obfuscated) / 1024
		).toFixed(2)} KB`,
	);
}

console.log(`\nObfuscated ${FILES.length} map modules in:\n  ${outDir}`);
console.log("Export names are preserved. This does not write into the engine tree.");
