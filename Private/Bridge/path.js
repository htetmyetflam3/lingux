// FILE: bridge/path.js
import fs from "fs";
import path from "path";

// ── Project Directory Constants ──
// Relative to the repo root. The terminal is always opened from project root.
// File workspace (tree / input / output / log) lives in the python project.
const TREE_DIR = "PDF/Python/File/.tree/";
const LOG_DIR = "PDF/Python/File/.output/.log/";
const OUTPUT_DIR = "PDF/Python/File/.output/txt/";
// CORRECTED for this repo (reference-for-kmt.md watch-out #1): the JSON
// constants used to point at the private layout (ENGINE/Part/Engine/...)
// where default-path calls failed with ENOENT. Here the knowledge JSON
// lives at Private/Engine/_knowledge/json (master.json.enc next to it).
const DATA_DIR = "Private/Engine/_knowledge/json";
const INPUT_DIR = "PDF/Python/File/input/";
const JSC_FILE = "Tools/map/map-runtime.jsc";

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

	throw new Error(`Input not found: ${abs}`);
}

export function InputFile() {
	return INPUT_DIR + "input.txt";
}

export function MasterFile() {
	return DATA_DIR + "/master.json";
}

export function JscFile() {
	return JSC_FILE;
}

// ── Path Utility Functions ──
export function resolvePath(p) {
	return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
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
