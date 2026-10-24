// FILE: bridge/path.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

// All runtime writes stay in an explicit workspace, never filesystem /File.
const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK = path.resolve(ENGINE_ROOT, "../output/tagger/.work/default");
let TREE_DIR = path.join(WORK, "tree");
let LOG_DIR = path.join(WORK, "log");
let OUTPUT_DIR = path.join(WORK, "out");
let DATA_DIR = path.join(WORK, "data");
const INPUT_DIR = path.join(WORK, "input") + path.sep;

// Called before importing/running the pipeline; dataDir holds a disposable
// copy because the supplied POS builder removes rejected dictionary rows.
export function configureWorkspace({ treeDir, logDir, outputDir, dataDir } = {}) {
  if (treeDir !== undefined) TREE_DIR = path.resolve(treeDir);
  if (logDir !== undefined) LOG_DIR = path.resolve(logDir);
  if (outputDir !== undefined) OUTPUT_DIR = path.resolve(outputDir);
  if (dataDir !== undefined) DATA_DIR = path.resolve(dataDir);
}

// ── Map build layout (MonoSyllabism/map) — the FIXED output dir ──
// Four artifacts land here, all consumed by the runtime through these names:
//   payload.jsc      encrypted V8 bytecode binary      <- obfuscator.js
//   loader.js        decrypting binary loader (ESM)    <- obfuscator.js
//   secure.js        obfuscated JSON reader module     <- encrypt.json.js
//   master.json.enc  the sealed tables (read as master.json — readSecureText
//                    transparently picks the ".enc" twin when it sits there)
// map/base/ beside them holds the two READABLE runtime modules
// (BurmeseToAscii.js readAndPrepare, idmapper.js burmeseToId): they consume
// the loader, they are never inside the payload. The payload's sources stay
// in MAP_SOURCE_DIR; the readable JSON the encryptor seals stays in
// JSON_SOURCE_FILE. Build scripts import these constants — no CLI paths.
const MAP_DIR = "MonoSyllabism/map";
const MAP_BINARY_FILE = MAP_DIR + "/payload.jsc";
const MAP_LOADER_FILE = MAP_DIR + "/loader.js";
const MAP_SECURE_FILE = MAP_DIR + "/secure.js";
const MAP_MASTER_FILE = MAP_DIR + "/master.json";
const MAP_SOURCE_DIR = "MonoSyllabism/mapbuilder/base";
const JSON_SOURCE_FILE = "knowledge/isTreasure/master.json";
// The historical JSC slot now names the map binary (Private/... pre-rename
// string retired — same consumer-facing getter names).
const JSC_FILE = MAP_BINARY_FILE;

export function resolveInputs(src) {
	const abs = resolvePath(src);

	if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
		const files = fs
			.readdirSync(abs)
			.filter((f) => f.endsWith(".txt"))
			.sort()
			.map((f) => path.join(abs, f));
		if (files.length === 0) throw new Error(`No .txt files in: ${abs}`);
		return files;
	}

	if (fs.existsSync(abs)) return [abs];

	throw new Error(`Input not fo6und: ${abs}`);
}

export function InputFile() {
	return INPUT_DIR + "input.txt";
}

export function MasterFile() {
	// Runtime default: the map copy. The readable plaintext lives at
	// JSON_SOURCE_FILE for the build; at runtime readSecureText() serves the
	// ".enc" twin beside this name, so callers never hold the readable name.
	return path.join(ENGINE_ROOT, MAP_MASTER_FILE);
}

// ── Map build paths (string form; the build scripts resolve them against the
//    repo root derived from their own location — never against the caller's cwd) ──
export function MapDir() {
	return MAP_DIR;
}

export function MapBinaryFile() {
	return MAP_BINARY_FILE;
}

export function MapLoaderFile() {
	return MAP_LOADER_FILE;
}

export function MapSecureFile() {
	return MAP_SECURE_FILE;
}

export function MapMasterFile() {
	return MAP_MASTER_FILE;
}

export function MapSourceDir() {
	return MAP_SOURCE_DIR;
}

export function JsonSourceFile() {
	return JSON_SOURCE_FILE;
}

export function JscFile() {
	return JSC_FILE;
}

// ── Path Utility Functions ──
export function resolvePath(p) {
	return path.isAbsolute(p) ? p : path.resolve(ENGINE_ROOT, p);
}

export function joinPath(...segments) {
	return path.join(...segments);
}

export function getDirname(p) {
	return path.dirname(p);
}

export function getBasename(p, ext) {
	return ext ? path.basename(p, ext) : path.basename(p);
}

// ── For modules writing files (relative strings) ──
export function DataFile() {
	return DATA_DIR;
}

export function OutputFile() {
	return OUTPUT_DIR;
}

export function LogFile() {
	return LOG_DIR;
}

export function TreeFile() {
	return TREE_DIR;
}

// ── For deletion/reset (resolved absolute paths) ──
export function GetDataDir() {
	return resolvePath(DATA_DIR);
}

export function GetInputDir() {
	return resolvePath(INPUT_DIR);
}

export function GetOutputDir() {
	return resolvePath(OUTPUT_DIR);
}

export function GetLogDir() {
	return resolvePath(LOG_DIR);
}

export function GetTreeDir() {
	return resolvePath(TREE_DIR);
}

export function GetJscFile() {
	return resolvePath(JSC_FILE);
}

export function GetMasterFile() {
	return resolvePath(MasterFile());
}

export function GetMapDir() {
	return resolvePath(MAP_DIR);
}

export function GetMapBinaryFile() {
	return resolvePath(MAP_BINARY_FILE);
}

export function GetMapLoaderFile() {
	return resolvePath(MAP_LOADER_FILE);
}

export function GetMapSecureFile() {
	return resolvePath(MAP_SECURE_FILE);
}

export function GetJsonSourceFile() {
	return resolvePath(JSON_SOURCE_FILE);
}

// ── Simple Glob Matcher ──
function matchPattern(filename, pattern) {
	const regex = new RegExp(
		"^" +
			pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") +
			"$",
	);
	return regex.test(filename);
}

// ── Directory Cleaner ──
function cleanDir(dirPath, opts) {
	if (!fs.existsSync(dirPath)) return;

	const excludeFiles = opts?.files || [];
	const excludeDirs = opts?.dirs || [];
	const tmpDir = path.join(dirPath, ".tmp-preserve");
	const preserved = [];

	function shouldExcludeDir(name, fullPath) {
		return excludeDirs.some((d) => {
			const target = resolvePath(d);
			return (
				name === d || fullPath === target || fullPath.endsWith(path.sep + d)
			);
		});
	}

	function scan(currentPath) {
		const entries = fs.readdirSync(currentPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(currentPath, entry.name);
			if (entry.name === ".tmp-preserve") continue;

			if (entry.isDirectory()) {
				if (shouldExcludeDir(entry.name, fullPath)) continue;
				scan(fullPath);
				try {
					fs.rmdirSync(fullPath);
				} catch {} // eslint-disable-line no-empty -- best-effort cleanup
			} else {
				if (excludeFiles.some((p) => matchPattern(entry.name, p))) {
					if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
					const tmpPath = path.join(tmpDir, entry.name);
					fs.renameSync(fullPath, tmpPath);
					preserved.push({ original: fullPath, tmp: tmpPath });
				} else {
					fs.unlinkSync(fullPath);
				}
			}
		}
	}

	scan(dirPath);

	for (const item of preserved) {
		if (fs.existsSync(item.original)) {
			const conflictName = item.original + ".restored-" + Date.now();
			fs.renameSync(item.tmp, conflictName);
		} else {
			fs.renameSync(item.tmp, item.original);
		}
	}

	if (fs.existsSync(tmpDir)) {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {} // eslint-disable-line no-empty -- best-effort cleanup
	}
}

export function onPathEnsure(dirPath, reset = null) {
	const resolved = resolvePath(dirPath);

	if (reset !== false && fs.existsSync(resolved)) {
		cleanDir(resolved, reset);
	}

	if (!fs.existsSync(resolved)) {
		fs.mkdirSync(resolved, { recursive: true });
	}

	return resolved;
}

export function resetWorkspace(opts = null) {
	const targets = [GetTreeDir(), GetOutputDir(), GetLogDir()];
	for (const dir of targets) {
		onPathEnsure(dir, opts);
	}
}
