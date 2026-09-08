#!/usr/bin/env node
/**
 * decrypt-data.js
 * Category: build
 *
 * Inverse of encrypt-data.js. AES-256-GCM decrypts a "<file>.enc" container
 * back to plaintext JSON. Uses the same key sidecar as encrypt-data.js.
 *
 * Layout of the .enc container:
 *   [4-byte magic "MGR1"][12-byte IV][16-byte auth tag][AES-256-GCM ciphertext]
 *
 * Usage:
 *   node Tools/create/decrypt-data.js <json-file.enc|json-file> [--key-file .secrets/data.key] [--out <file>]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const argFile = process.argv[2];
const argValue = (name) => {
	const i = process.argv.indexOf(name);
	return i === -1 ? undefined : process.argv[i + 1];
};
const keyFile = argValue("--key-file") || path.join(REPO_ROOT, ".secrets", "data.key");
const outArg = argValue("--out");

if (!argFile) {
	console.error("Usage: node Tools/create/decrypt-data.js <json-file.enc|json-file> [--key-file <key>] [--out <file>]");
	process.exit(1);
}

const inputPath = path.resolve(argFile);
const encPath = inputPath.endsWith(".enc") ? inputPath : inputPath + ".enc";
if (!fs.existsSync(encPath)) {
	console.error(`Encrypted file not found: ${encPath}`);
	process.exit(1);
}
if (!fs.existsSync(keyFile)) {
	console.error(`Key file not found: ${keyFile}`);
	process.exit(1);
}

const keyHex = fs.readFileSync(keyFile, "utf8").trim();
const key = Buffer.from(keyHex, "hex");
if (key.length !== 32) {
	console.error(`Key must be 32 bytes (hex) — got ${key.length}`);
	process.exit(1);
}

const buf = fs.readFileSync(encPath);
if (buf.length < 32 || buf.subarray(0, 4).toString("ascii") !== "MGR1") {
	console.error(`Invalid .enc container: ${encPath}`);
	process.exit(1);
}

const iv = buf.subarray(4, 16);
const tag = buf.subarray(16, 32);
const ct = buf.subarray(32);
const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(tag);
const plain = Buffer.concat([decipher.update(ct), decipher.final()]);

const outPath = outArg
	? path.resolve(outArg)
	: encPath.endsWith(".enc")
		? encPath.slice(0, -4)
		: encPath + ".json";
fs.writeFileSync(outPath, plain);
console.log(`Decrypted ${path.basename(encPath)} -> ${path.basename(outPath)} (${plain.length} bytes)`);
