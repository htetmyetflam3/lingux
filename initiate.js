#!/usr/bin/env node
/**
 * initiate.js — Lingux End-to-End Pipeline Setup & Server Bootstrapping
 *
 * Automates the entire project bootstrap pipeline:
 *  1. Map Directory & Encrypted JSON Build:
 *     - Encrypts master.json if plaintext exists and secures secure.js
 *     - Builds/verifies map binary bytecode (map-runtime.jsc) from map source dir (e.g. ../../mymap/)
 *     - Verifies encrypted JSON and map binary loader
 *  2. Engine Tree Generation:
 *     - Invokes Syllable.initS.js runBuildPhase() to build syllable lookup + POS trees
 *     - Syncs generated trees to PRASER output directory
 *  3. Boosts PRASER Python Flask API (127.0.0.1:5055)
 *  4. Builds the SPA frontend via Vite & Sass
 *  5. Boosts Express Server (Site/index.js) with nodemon / node to serve the SPA
 *
 * Usage:
 *   node initiate.js [--src <map-dir>] [--dev] [--port <port>]
 *   node Tools/build/initiate.js [../../mymap]
 *   npm run initiate
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// If run from Tools/build, REPO_ROOT is two levels up; if run from root, it is __dirname.
const REPO_ROOT = fs.existsSync(path.join(__dirname, "package.json"))
	? __dirname
	: path.resolve(__dirname, "../..");

process.chdir(REPO_ROOT);

// ── Parse CLI Arguments ──
const args = process.argv.slice(2);
function getArg(name) {
	const idx = args.indexOf(name);
	return idx !== -1 ? args[idx + 1] : undefined;
}
const hasFlag = (name) => args.includes(name);

const positionalSrc = args.find((a) => !a.startsWith("-"));
const rawMapDir = getArg("--src") || getArg("--map-dir") || positionalSrc;
const useNodemon = hasFlag("--dev") || hasFlag("--nodemon") || !hasFlag("--no-nodemon");
const skipBuild = hasFlag("--skip-build");
const skipFlask = hasFlag("--no-flask");
const PORT = Number(getArg("--port") || process.env.PORT || 3000);
const FLASK_PORT = Number(getArg("--flask-port") || process.env.PRASER_PORT || 5055);

// ── Colors for console ──
const c = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	green: "\x1b[32m",
	teal: "\x1b[36m",
	yellow: "\x1b[33m",
	coral: "\x1b[38;5;209m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
};

console.log(`${c.bold}${c.teal}╔═══════════════════════════════════════════════════════════════╗${c.reset}`);
console.log(`${c.bold}${c.teal}║       Lingux — Pipeline Bootstrapping & Server Setup          ║${c.reset}`);
console.log(`${c.bold}${c.teal}╚═══════════════════════════════════════════════════════════════╝${c.reset}\n`);

// ── Helper: Locate Map Source Directory ──
function resolveMapSourceDir(raw) {
	if (raw) {
		const direct = path.resolve(process.cwd(), raw);
		if (fs.existsSync(direct)) return direct;
		const fromRepo = path.resolve(REPO_ROOT, raw);
		if (fs.existsSync(fromRepo)) return fromRepo;
		const fromTools = path.resolve(REPO_ROOT, "Tools", "build", raw);
		if (fs.existsSync(fromTools)) return fromTools;
		return direct;
	}
	const candidates = [
		path.resolve(REPO_ROOT, "Tools", "build", "../../mymap"),
		path.resolve(REPO_ROOT, "../mymap"),
		path.resolve(REPO_ROOT, "mymap"),
		path.resolve(REPO_ROOT, "Private", "Syllable", "mapper", "map"),
	];
	for (const cand of candidates) {
		if (fs.existsSync(cand) && fs.existsSync(path.join(cand, "sourceMap.js"))) {
			return cand;
		}
	}
	return path.resolve(REPO_ROOT, "Private", "Syllable", "mapper", "map");
}

// ── Helper: Poll HTTP endpoint ──
async function pollEndpoint(url, timeoutMs = 30000, intervalMs = 500) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const ok = await new Promise((resolve) => {
				const req = http.get(url, (res) => {
					resolve(res.statusCode >= 200 && res.statusCode < 400);
				});
				req.on("error", () => resolve(false));
				req.setTimeout(1000, () => {
					req.destroy();
					resolve(false);
				});
			});
			if (ok) return true;
		} catch {}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return false;
}

const childProcesses = [];
function cleanup() {
	console.log(`\n${c.yellow}[Lingux] Stopping background services...${c.reset}`);
	for (const proc of childProcesses) {
		try {
			process.kill(-proc.pid, "SIGTERM");
		} catch {
			try {
				proc.kill("SIGTERM");
			} catch {}
		}
	}
}
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });

// ── Pipeline Execution ──
async function main() {
	// ─────────────────────────────────────────────────────────────────────────
	// STEP 1: Map Directory & Encrypted JSON Build
	// ─────────────────────────────────────────────────────────────────────────
	console.log(`${c.bold}${c.yellow}[Step 1/5] Checking Encrypted JSON & Map Binary Runtime...${c.reset}`);

	const masterJsonPlain = path.join(REPO_ROOT, "Private", "Engine", "_knowledge", "json", "master.json");
	const masterJsonEnc = masterJsonPlain + ".enc";

	if (fs.existsSync(masterJsonPlain) && !fs.existsSync(masterJsonEnc)) {
		console.log(`  Encrypting ${path.basename(masterJsonPlain)} -> .enc...`);
		spawnSync(process.execPath, [path.join(REPO_ROOT, "Tools", "build", "encrypt-data.js"), masterJsonPlain], {
			cwd: REPO_ROOT,
			stdio: "inherit",
		});
		spawnSync(process.execPath, [path.join(REPO_ROOT, "Tools", "build", "build-secure.js")], {
			cwd: REPO_ROOT,
			stdio: "inherit",
		});
	}

	// Verify secure JSON decryption
	try {
		const { readSecureJson } = await import("./Private/Bridge/secure.js");
		const data = readSecureJson(masterJsonPlain);
		const keys = Object.keys(data);
		console.log(`  ${c.green}✓${c.reset} Encrypted JSON verified (${keys.join(", ")})`);
	} catch (err) {
		console.error(`${c.red}  ✗ Failed to read encrypted JSON: ${err.message}${c.reset}`);
		process.exit(1);
	}

	// Check/Build map bytecode
	const mapDir = resolveMapSourceDir(rawMapDir);
	const hasSourceFiles = fs.existsSync(path.join(mapDir, "sourceMap.js"));
	const jscFile = path.join(REPO_ROOT, "Private", "Syllable", "mapper", "map", "map-runtime.jsc");

	if (hasSourceFiles) {
		console.log(`  Building bytecode from map source dir: ${c.dim}${mapDir}${c.reset}`);
		const buildBytecodeScript = path.join(REPO_ROOT, "Tools", "build", "build-bytecode.js");
		const res = spawnSync(process.execPath, [buildBytecodeScript, "--src", mapDir], {
			cwd: REPO_ROOT,
			stdio: "inherit",
		});
		if (res.status !== 0) {
			console.error(`${c.red}  ✗ Bytecode compilation failed${c.reset}`);
			process.exit(res.status || 1);
		}
	} else if (fs.existsSync(jscFile)) {
		console.log(`  Using existing binary map bytecode: ${c.dim}${jscFile}${c.reset}`);
	} else {
		console.error(`${c.red}  ✗ No map sources and no map-runtime.jsc found!${c.reset}`);
		process.exit(1);
	}

	// Test map-loader
	try {
		const mapLoader = await import("./Tools/map/map-loader.js");
		const normalized = mapLoader.MyNormalize("ကတ်");
		console.log(`  ${c.green}✓${c.reset} Map runtime verified (MyNormalize('ကတ်') -> '${normalized}')`);
	} catch (err) {
		console.error(`${c.red}  ✗ Map loader failed: ${err.message}${c.reset}`);
		process.exit(1);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// STEP 2: Boost Syllable Engine & Build Trees (Syllable.initS.js)
	// ─────────────────────────────────────────────────────────────────────────
	console.log(`\n${c.bold}${c.yellow}[Step 2/5] Boosting Syllable.initS.js & Building Trees...${c.reset}`);
	const { runBuildPhase } = await import("./Private/monoSyllabism/Syllable.initS.js");
	try {
		await runBuildPhase();
		console.log(`  ${c.green}✓${c.reset} Syllable & POS trees generated successfully.`);

		// Sync trees to PRASER output directory if present
		const praserTreeDir = path.join(REPO_ROOT, "Site", "Public", "PRASER", "Python", "output", ".tree");
		const engineTreeDir = path.join(REPO_ROOT, "PDF", "Python", "File", ".tree");
		if (fs.existsSync(engineTreeDir)) {
			fs.mkdirSync(praserTreeDir, { recursive: true });
			for (const f of fs.readdirSync(engineTreeDir)) {
				fs.copyFileSync(path.join(engineTreeDir, f), path.join(praserTreeDir, f));
			}
			console.log(`  ${c.green}✓${c.reset} Synced tree files to PRASER Python output.`);
		}
	} catch (err) {
		console.error(`${c.red}  ✗ Tree build phase failed: ${err.message}${c.reset}`);
		process.exit(1);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// STEP 3: Boost PRASER Python Flask API
	// ─────────────────────────────────────────────────────────────────────────
	if (!skipFlask) {
		console.log(`\n${c.bold}${c.yellow}[Step 3/5] Boosting PRASER Python Flask API (Port ${FLASK_PORT})...${c.reset}`);
		const flaskHealthUrl = `http://127.0.0.1:${FLASK_PORT}/health`;
		const isFlaskUp = await pollEndpoint(flaskHealthUrl, 1000, 200);

		if (isFlaskUp) {
			console.log(`  ${c.green}✓${c.reset} PRASER Flask API already running on http://127.0.0.1:${FLASK_PORT}`);
		} else {
			const pyScript = path.join(REPO_ROOT, "Site", "Public", "PRASER", "Python", "module", "cli.py");
			const flaskProc = spawn("python3", [pyScript, "--serve", "--host", "127.0.0.1", "--port", String(FLASK_PORT)], {
				cwd: path.dirname(pyScript),
				stdio: ["ignore", "pipe", "pipe"],
				detached: true,
			});
			childProcesses.push(flaskProc);

			flaskProc.stderr.on("data", (d) => {
				const str = d.toString();
				if (!str.includes("WARNING: This is a development server")) {
					// Log flask diagnostics if needed
				}
			});

			console.log(`  Waiting for Flask API to be healthy on :${FLASK_PORT}...`);
			const healthy = await pollEndpoint(flaskHealthUrl, 15000, 500);
			if (healthy) {
				console.log(`  ${c.green}✓${c.reset} PRASER Python Flask live on http://127.0.0.1:${FLASK_PORT}`);
			} else {
				console.warn(`  ${c.yellow}⚠ Flask API did not respond to /health in time (continuing...)${c.reset}`);
			}
		}
	} else {
		console.log(`\n${c.bold}${c.yellow}[Step 3/5] Skipping Python Flask API (--no-flask)${c.reset}`);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// STEP 4: Build SPA Application (Vite & Sass)
	// ─────────────────────────────────────────────────────────────────────────
	console.log(`\n${c.bold}${c.yellow}[Step 4/5] Building SPA Application (Vite & Sass)...${c.reset}`);
	if (!skipBuild) {
		const viteConfig = path.join(REPO_ROOT, "Site", "Public", "STATIC", "Build", "vite.config.js");
		try {
			execSync(`npx vite build --config ${viteConfig}`, {
				cwd: REPO_ROOT,
				stdio: "inherit",
			});
			console.log(`  ${c.green}✓${c.reset} SPA built successfully into Site/Public/STATIC/frontend.`);
		} catch (err) {
			console.error(`${c.red}  ✗ Vite build failed: ${err.message}${c.reset}`);
			process.exit(1);
		}
	} else {
		console.log(`  ${c.dim}Skipped (--skip-build)${c.reset}`);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// STEP 5: Boost Express Server (Site/index.js)
	// ─────────────────────────────────────────────────────────────────────────
	console.log(`\n${c.bold}${c.yellow}[Step 5/5] Boosting Express Server (Site/index.js on Port ${PORT})...${c.reset}`);

	process.env.PORT = String(PORT);
	process.env.PRASER_ENDPOINT = `http://127.0.0.1:${FLASK_PORT}`;
	process.env.SKIP_BUILD = "true"; // Already built in step 4

	const expressCmd = useNodemon ? "npx" : "node";
	const expressArgs = useNodemon
		? ["nodemon", "--watch", "Site", "--watch", "Private", "Site/index.js"]
		: ["Site/index.js"];

	console.log(`  Launching: ${expressCmd} ${expressArgs.join(" ")}`);
	const serverProc = spawn(expressCmd, expressArgs, {
		cwd: REPO_ROOT,
		stdio: "inherit",
		env: process.env,
		detached: true,
	});
	childProcesses.push(serverProc);

	// Poll Express server
	const expressUrl = `http://localhost:${PORT}/`;
	const isExpressUp = await pollEndpoint(expressUrl, 20000, 500);

	if (isExpressUp) {
		console.log(`\n${c.bold}${c.green}═══════════════════════════════════════════════════════════════${c.reset}`);
		console.log(`${c.bold}${c.green}  ★ LINGUX PIPELINE READY & ALL SERVICES BOOSTED ★             ${c.reset}`);
		console.log(`${c.bold}${c.green}═══════════════════════════════════════════════════════════════${c.reset}`);
		console.log(`  ${c.coral}•${c.reset} SPA Web App:      ${c.bold}http://localhost:${PORT}${c.reset}`);
		console.log(`  ${c.coral}•${c.reset} PRASER Flask API: ${c.bold}http://127.0.0.1:${FLASK_PORT}${c.reset}`);
		console.log(`  ${c.coral}•${c.reset} Engine Trees:     ${c.bold}PDF/Python/File/.tree/${c.reset}`);
		console.log(`  ${c.coral}•${c.reset} Supervisor:       ${c.bold}${useNodemon ? "nodemon" : "node"}${c.reset}\n`);
	} else {
		console.log(`  ${c.yellow}Express server starting up...${c.reset}`);
	}

	// Keep process alive for nodemon/flask supervision
	await new Promise(() => {});
}

main().catch((err) => {
	console.error(`${c.red}Bootstrap fatal error: ${err.message}${c.reset}`);
	cleanup();
	process.exit(1);
});
