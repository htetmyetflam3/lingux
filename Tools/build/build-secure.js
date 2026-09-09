#!/usr/bin/env node
/**
 * build-secure.js
 * Category: build
 *
 * Obfuscates ENGINE/Part/Bridge/secure.js in place so the AES key and decrypt
 * logic aren't readable, while preserving its named exports (readSecureText,
 * readSecureJson) so the engine's loaders keep importing it unchanged.
 *
 * Steps:
 *   1. encrypt-data.js  encrypts master.json -> master.json.enc and injects the
 *                       key into secure.js (plaintext placeholder).
 *   2. build-secure.js  obfuscates secure.js in place.
 *
 * Because obfuscation runs AFTER key injection, the key is hidden too.
 * Keep the readable secure.js + master.json as local build inputs (gitignored);
 * commit the obfuscated secure.js and the .enc file.
 *
 * Prerequisite: npm install --no-save javascript-obfuscator
 *
 * Usage:
 *   node Tools/create/encrypt-data.js ENGINE/Part/Engine/_knowledge/json/master.json
 *   node Tools/create/build-secure.js
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JavaScriptObfuscator from "javascript-obfuscator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SECURE_MODULE = fs.existsSync(path.join(REPO_ROOT, "Private", "Bridge", "secure.js"))
	? path.join(REPO_ROOT, "Private", "Bridge", "secure.js")
	: path.join(REPO_ROOT, "ENGINE", "Part", "Bridge", "secure.js");

if (!fs.existsSync(SECURE_MODULE)) {
	console.error(`secure.js not found: ${SECURE_MODULE}`);
	process.exit(1);
}

const src = fs.readFileSync(SECURE_MODULE, "utf8");
const out = JavaScriptObfuscator.obfuscate(src, {
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
}).getObfuscatedCode();

fs.writeFileSync(SECURE_MODULE, out, "utf8");
console.log(`Obfuscated ${path.relative(REPO_ROOT, SECURE_MODULE)}: ${(Buffer.byteLength(src) / 1024).toFixed(2)} KB -> ${(Buffer.byteLength(out) / 1024).toFixed(2)} KB`);
