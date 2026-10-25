// Map build utility — regenerate the readable knowledge JSON from the sealed
// container.
//
// New home (was Engine/Bridge/restore-master.js in the scraper shim layout):
// sits next to the secure reader it uses. The encrypted twin
// (master.json.enc) is decrypted in memory by secure.js — the key is sealed
// inside it, so no .secrets/ sidecar is needed. The readable output
// (architecture/knowledge/isTreasure/master.json) is a LOCAL build input:
// gitignored, never shipped.
//
// Run when rebuilding the map payload on a machine:
//   node Engine/architecture/MonoSyllabism/map/restore-master.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readSecureText } from "./secure.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// map/ -> MonoSyllabism/ -> architecture/ (the engine root path.js anchors)
const ENGINE_ROOT = path.resolve(HERE, "..", "..");
const TARGET = path.join(ENGINE_ROOT, "knowledge", "isTreasure", "master.json");
const SEALED = path.join(HERE, "master.json");

if (fs.existsSync(TARGET)) {
	console.log(`[restore-master] already present: ${TARGET}`);
	process.exit(0);
}
const text = readSecureText(SEALED); // reads the .enc twin, decrypts in memory
JSON.parse(text); // sanity: the container must hold valid JSON
fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, text, "utf8");
console.log(`[restore-master] ${TARGET} restored from master.json.enc (${text.length} chars)`);
