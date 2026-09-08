#!/usr/bin/env node
/**
 * build-bytecode.js
 * Category: build
 *
 * Compiles the protected map runtime into V8 bytecode (a single small .jsc
 * file). The CJS runtime `map-runtime.cjs` is the payload you want to hide
 * (AES-256-GCM encrypted + obfuscated); compiling it to V8 bytecode with
 * `bytenode` produces a ~56 KB artifact that exposes the same named bindings
 * but contains no plaintext JS source.
 *
 * Pipeline:  readable map source
 *              → (Tools/build/bundler.js)   flattened  <map-dir>/bundle.js
 *              → (Tools/build/build.js)     obfuscated + encrypted  <map-dir>/map-runtime.cjs
 *              → (bytenode)                 <map-dir>/map-runtime.jsc  (this script)
 *
 * All outputs are written INSIDE the map dir (Private/Syllable/mapper/map),
 * next to the sources and the map-loader.js — so every rebuild lands there
 * automatically. The engine loads the result through map/map-loader.js.
 *
 * Prerequisite (once):
 *   npm install --no-save bytenode
 *
 * Usage:
 *   node Tools/build/build-bytecode.js                        # rebuild everything from the map dir
 *   node Tools/build/build-bytecode.js --src <readable-map-dir>  # build from another dir
 *
 * Output:
 *   <map-dir>/map-runtime.jsc  – the bytecode artifact
 *
 * Import it (the way the engine does):
 *   node --input-type=module -e "import * as m from './Private/Syllable/mapper/map/map-loader.js'; console.log(m.MyNormalize('ကတ်'))"
 *
 * ⚠️ Version caveat: V8 bytecode is tied to the exact Node/V8 version that
 * compiled it. A `.jsc` built on Node X will only run on Node X (or a
 * compatible build). Regenerate it on the runtime you deploy on. For a fully
 * portable artifact, ship the AES-encrypted JS (`map-runtime.cjs`) instead.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
// All relative paths inside child scripts resolve against the repo root.
process.chdir(REPO_ROOT);

const require = createRequire(import.meta.url);

// The in-repo map dir: build inputs AND outputs live here.
const MAP_DIR = path.join(REPO_ROOT, "Private", "Syllable", "mapper", "map");

const argValue = (name) => {
	const i = process.argv.indexOf(name);
	return i === -1 ? undefined : process.argv[i + 1];
};
// Default --src to the map dir, so a plain run rebuilds everything in place.
const srcDir = argValue("--src") || MAP_DIR;

const run = (cmd, args, stage) => {
	const res = spawnSync(cmd, args, { cwd: REPO_ROOT, stdio: "inherit" });
	if (res.status !== 0) {
		console.error(`\n[FAIL] ${stage} (exit ${res.status})`);
		process.exit(res.status || 1);
	}
	console.log("");
};

// Sibling build scripts, resolved next to this file so the pipeline works
// regardless of the folder name (Tools/build/ here, Tools/create/ elsewhere).
const PREPARE = path.join(__dirname, "bundler.js");
const BUILD = path.join(__dirname, "build.js");

// 1) Flatten + build runtimes from the readable map source.
if (!fs.existsSync(srcDir)) {
	console.error(`Readable map source dir not found: ${srcDir}`);
	process.exit(1);
}
run(process.execPath, [PREPARE, "--src", srcDir], "prepare-map-bundle");
run(process.execPath, [BUILD], "build.js (obfuscate + encrypt)");

// 2) Load bytenode (CJS dependency).
let bytenode;
try {
	bytenode = require("bytenode");
} catch {
	console.error("bytenode is not installed. Run:\n  npm install --no-save bytenode");
	process.exit(1);
}

// 3) Compile the CJS runtime to V8 bytecode — into the map dir.
const cjs = path.join(MAP_DIR, "map-runtime.cjs");
const out = path.join(MAP_DIR, "map-runtime.jsc");
console.log(`Compiling ${path.relative(REPO_ROOT, cjs)} -> ${path.relative(REPO_ROOT, out)} (V8 bytecode)...`);
try {
	bytenode.compileFile(cjs, out);
} catch (err) {
	console.error("Compilation failed:", err.message);
	process.exit(1);
}
const size = fs.statSync(out).size;
console.log(`  map-runtime.jsc: ${(size / 1024).toFixed(2)} KB`);

// 4) Verify the bytecode artifact loads and exposes the bindings.
try {
	delete require.cache[out];
	const api = require(out);
	console.log("\nVerifying bytecode artifact:");
	console.log("  MyNormalize('ကတ်'):", api.MyNormalize("ကတ်"));
	console.log("  ALL_DIGITS size:", api.ALL_DIGITS ? api.ALL_DIGITS.size : null);
	console.log("  isTail('*'):", api.isTail("*"));
	console.log("  PUNCTUATION size:", api.PUNCTUATION ? api.PUNCTUATION.size : null);
	console.log("\nBytecode artifact OK.");
} catch (err) {
	console.error("\nBytecode verification FAILED:", err.message);
	process.exit(1);
}
