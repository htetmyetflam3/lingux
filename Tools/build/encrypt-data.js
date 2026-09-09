#!/usr/bin/env node
/**
 * encrypt-data.js
 * Category: build
 *
 * AES-256-GCM encrypts a sensitive JSON data file (e.g. the handcrafted
 * master.json) into "<file>.enc" and injects the matching key into
 * ENGINE/Part/Bridge/secure.js (which the engine imports to decrypt at read
 * time). The key is also kept in a local, gitignored sidecar so the file can
 * be re-encrypted later without changing the key.
 *
 * Layout of the .enc container:
 *   [4-byte magic "MGR1"][12-byte IV][16-byte auth tag][AES-256-GCM ciphertext]
 *
 * Usage:
 *   node Tools/create/encrypt-data.js <json-file> [--key-file .secrets/data.key]
 *
 * Prerequisites:
 *   npm install --no-save <obfuscator for build-secure.js>  (see build-secure.js)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SECURE_MODULE = path.join(REPO_ROOT, "ENGINE", "Part", "Bridge", "secure.js");

const argFile = process.argv[2];
const argValue = (name) => {
	const i = process.argv.indexOf(name);
	return i === -1 ? undefined : process.argv[i + 1];
};
const keyFile = argValue("--key-file") || path.join(REPO_ROOT, ".secrets", "data.key");

if (!argFile) {
	console.error("Usage: node Tools/create/encrypt-data.js <json-file> [--key-file <key>]");
	process.exit(1);
}
const jsonPath = path.resolve(argFile);
if (!fs.existsSync(jsonPath)) {
	console.error(`File not found: ${jsonPath}`);
	process.exit(1);
}

// Load or create an AES-256 key (32 bytes).
let keyHex;
if (fs.existsSync(keyFile)) {
	keyHex = fs.readFileSync(keyFile, "utf8").trim();
} else {
	keyHex = crypto.randomBytes(32).toString("hex");
	fs.mkdirSync(path.dirname(keyFile), { recursive: true });
	fs.writeFileSync(keyFile, keyHex + "\n", "utf8");
	console.log(`Generated new key -> ${keyFile}`);
}
const key = Buffer.from(keyHex, "hex");
if (key.length !== 32) {
	console.error(`Key must be 32 bytes (hex) — got ${key.length}`);
	process.exit(1);
}

// Encrypt.
const iv = crypto.randomBytes(12);
const data = fs.readFileSync(jsonPath);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([cipher.update(data), cipher.final()]);
const tag = cipher.getAuthTag();
const container = Buffer.concat([Buffer.from("MGR1", "ascii"), iv, tag, ct]);

const out = jsonPath + ".enc";
fs.writeFileSync(out, container);
console.log(`Encrypted ${path.basename(jsonPath)} -> ${path.basename(out)} (${container.length} bytes)`);

// Inject the key into the secure module (replaces the placeholder).
if (fs.existsSync(SECURE_MODULE)) {
	let src = fs.readFileSync(SECURE_MODULE, "utf8");
	src = src.replace(/__SECURE_KEY__/g, keyHex);
	fs.writeFileSync(SECURE_MODULE, src, "utf8");
	console.log(`Injected key into secure.js`);
} else {
	console.error(`WARNING: ${SECURE_MODULE} not found; key not injected.`);
}
