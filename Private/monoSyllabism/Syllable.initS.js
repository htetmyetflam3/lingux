/* ═══════════════════════════════════════════════════════════════
   Syllable.initS.js — standalone engine entry

   Importing this module runs NO side effects: no .env read, no logger
   init, no argv parsing. Everything initialises lazily on first call,
   so the engine can be imported from any project / directory without
   Express and without disturbing the host process.

   See configure() below to point it at your own .env / input path.
   ═══════════════════════════════════════════════════════════════ */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
	init as initLog,
	pipelineStart,
	pipelineEnd,
	pipelineError,
	setLogBatch,
} from "../Bridge/logen.js";
import { init } from "./main/phoneme/init.js";
import { runBuild, runBuildPos } from "./graph/build.js";
import { bridge, bridgeSyllable } from "../Bridge/bridge.js";
import { resolveInputs, InputFile, resetWorkspace } from "../Bridge/path.js";
import { setHash, resetHash } from "../Bridge/store.js";
import { getDateTimeHash } from "../Bridge/logen.js";
import { invokeWithHash, hashKind } from "../Engine/Ginit.js";

/* ── small helpers ───────────────────────────────────────────── */

// ── Default .env, anchored to this file (not cwd) ──
const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENV = path.resolve(ENGINE_DIR, "..", "..", ".env");

// ── argv[2] is the input path ONLY when this file is run directly.
//    When cli.js is the entry it owns argv, so we must not read it here. ──
const ARGV_SRC =
	import.meta.url === `file://${process.argv[1]}` ? process.argv[2] : undefined;

function loadEnv(envPath) {
	const flags = {};
	try {
		const text = fs.readFileSync(envPath, "utf8");
		for (const line of text.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq === -1) continue;
			const key = trimmed.slice(0, eq).trim();
			const val = trimmed.slice(eq + 1).trim();
			flags[key] = val;
		}
	} catch {
		/* no .env, use defaults */
	}
	return flags;
}

function getFlag(env, key, defaultVal) {
	const val = env[key];
	if (val === undefined) return defaultVal;
	if (val === "true") return true;
	if (val === "false") return false;
	return val;
}

/* ── lazy module state (nothing runs on import) ──────────────── */

let _ready = false;
const _state = {
	WRITE_SYLLABLE: true,
	WRITE_POS: true,
	SEGMENTED_MODE: "single",
	DEBUG_MODE: false,
	SRC: null,
	ENV: {},
};

function _ensureInit(envPath) {
	if (_ready) return;
	_ready = true;

	const env = loadEnv(envPath !== undefined ? envPath : DEFAULT_ENV);
	_state.ENV = env;

	_state.WRITE_SYLLABLE = getFlag(env, "WRITE_SYLLABLE", true);
	_state.WRITE_POS = getFlag(env, "WRITE_POS", true);
	_state.SEGMENTED_MODE = getFlag(env, "SEGMENTED_MODE", "single");
	_state.DEBUG_MODE = getFlag(env, "DEBUG_MODE", false);

	initLog({
		DEBUG: _state.DEBUG_MODE === true,
		MODE: "multi",
		SEGMENTED_MODE: _state.SEGMENTED_MODE,
	});
	setLogBatch(_state.SEGMENTED_MODE === "batch");

	_state.SRC = ARGV_SRC || env.INPUT_PATH || InputFile();
}

/* ── configure (for cross-project / standalone callers) ──────── */

/**
 * Configure the engine before calling the pipeline.
 * Precedence: explicit opts > .env file > built-in defaults.
 * Call once before the first pipeline call; a second call is a no-op
 * (only the first configure wins).
 *
 * @param {object}  [opts]
 * @param {string}  [opts.envPath]          – .env file to read (default <engine>/../.env)
 * @param {string}  [opts.srcPath]          – input file or directory (default env INPUT_PATH or File/input/input.txt)
 * @param {boolean} [opts.writeSyllable]
 * @param {string}  [opts.segmentedMode]    – "single" | "batch"
 * @param {boolean} [opts.debugMode]
 */
export function configure(opts = {}) {
	if (_ready) return; // first configure wins; create a new process to reconfigure

	const env = loadEnv(opts.envPath !== undefined ? opts.envPath : DEFAULT_ENV);
	_state.ENV = env;

	_state.WRITE_SYLLABLE =
		opts.writeSyllable !== undefined
			? opts.writeSyllable
			: getFlag(env, "WRITE_SYLLABLE", true);

	_state.WRITE_POS =
		opts.writePos !== undefined
			? opts.writePos
			: getFlag(env, "WRITE_POS", true);

	_state.SEGMENTED_MODE =
		opts.segmentedMode !== undefined
			? opts.segmentedMode
			: getFlag(env, "SEGMENTED_MODE", "single");

	_state.DEBUG_MODE =
		opts.debugMode !== undefined
			? opts.debugMode
			: getFlag(env, "DEBUG_MODE", false);

	initLog({
		DEBUG: _state.DEBUG_MODE === true,
		MODE: "multi",
		SEGMENTED_MODE: _state.SEGMENTED_MODE,
	});
	setLogBatch(_state.SEGMENTED_MODE === "batch");

	_state.SRC =
		opts.srcPath !== undefined
			? opts.srcPath
			: ARGV_SRC || env.INPUT_PATH || InputFile();

	_ready = true;
}

/* ── public API (identical behaviour, now side-effect-free on import) ── */

export async function runBuildPhase() {
	_ensureInit();
	// Memory first: refArray threads straight into runBuildPos (no disk
	// round-trip); file fallback inside runBuildPos covers standalone runs.
	const { refArray } = await runBuild();
	await runBuildPos(undefined, refArray);
}

export async function grammarPipeline(opts = {}) {
	/* Apply per-call source/flags before the lazy initialisation. */
	if (!_ready && Object.keys(opts).length) configure(opts);
	_ensureInit();
	const hashes = await runMain(opts);

	/* invokeWithHash() reads the raw_pos file. If POS was not asked for,
	   that file does not exist by design — do not go looking for it and
	   do not call a syllable-only run a failure. */
	const wantPos = opts.writePos !== undefined ? opts.writePos : _state.WRITE_POS;

	const output = [];
	for (const hash of hashes) {
		if (!wantPos) {
			output.push({ hash, text: null });
			continue;
		}
		try {
			const text = await invokeWithHash(hash);
			output.push({ hash, text });
		} catch (err) {
			console.warn(`[grammarPipeline] ${err.message}`);
			output.push({ hash, text: null, error: err.message });
		}
	}
	return output;
}

export async function runMain(opts = {}) {
	_ensureInit();

	/* An outside id becomes a filename — refuse anything that is not one
	   of our known shapes (engine ts, uuid, 32-hex session). */
	if (opts.hash !== undefined && !hashKind(opts.hash))
		throw new Error(`[runMain] unusable hash: ${JSON.stringify(opts.hash)}`);

	const writeFlags = {
		syllable:
			opts.writeSyllable !== undefined ? opts.writeSyllable : _state.WRITE_SYLLABLE,
		/* invokeWithHash() reads the raw_pos file, so POS on is the default.
		   Off is now safe rather than broken: runMain picks bridgeSyllable()
		   below, which never builds the tagger — for callers that only want
		   syllable positions. */
		rawPos: opts.writePos !== undefined ? opts.writePos : _state.WRITE_POS,
	};

	resetWorkspace();
	const inputs = resolveInputs(opts.srcPath !== undefined ? opts.srcPath : _state.SRC);
	await runBuildPhase();

	const results = [];
	for (const inputPath of inputs) {
		pipelineStart({ inputFile: inputPath });

		try {
			/* Caller may supply its own id (server branch: submitId / formId)
			   so output files land as segmented_{theirId}_* and their existing
			   invokeWithHash(theirId) reads them back. Validated because this
			   string becomes a filename. */
			const hash = opts.hash ?? getDateTimeHash();
			setHash(hash);
			const seg = init(inputPath, hash);
			/* One flag, one chain — no unasked-for work, no second pass. */
			const result = writeFlags.rawPos
				? await bridge(seg, writeFlags, hash, inputPath)
				: await bridgeSyllable(seg, writeFlags, hash, inputPath);

			pipelineEnd({ inputPath });
			results.push({
				input: inputPath,
				syllable: result.syllablePath,
				rawPos: result.rawPosPath,
				lineCount: result.lineCount,
				hash,
			});
		} catch (err) {
			pipelineError({ message: err.message, file: inputPath });
			results.push({ input: inputPath, error: err.message });
		} finally {
			resetHash();
		}
	}

	/* return only hashes */
	return results.map((r) => r.hash).filter(Boolean);
}

/* ── CLI entry point ─────────────────────────────────────────── */
if (import.meta.url === `file://${process.argv[1]}`) {
	_ensureInit();

	const opts = {
		writeSyllable:
			process.argv[3] !== undefined ? process.argv[3] !== "false" : _state.WRITE_SYLLABLE,
	};

	grammarPipeline(opts)
		.then((results) => {
			const label = results.length === 1 ? "File complete" : "Batch complete";
			console.log(`\n${label}:`);
			for (const r of results) {
				const status = r.error
					? `FAIL: ${r.error}`
					: r.text === null
						? `OK  → syllable only`
						: `OK  → ${r.text.length} chars`;
				console.log(`  ${r.hash}: ${status}`);
			}
		})
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}