#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   api-server.js — minimal HTTP wrapper around the engine

   The public API does NOT hand back ready-made segmented text. It hands
   back POSITIONS and the caller writes the segmentation into its OWN
   original string. See Grule/Ginit.js → invokeSyllableWithHash().

   Zero extra dependencies (native node:http).

   Endpoints:
     GET  /health   → { ok: true }
     POST /process  → { hash, syllable: [ { index, syllable: [...] } ] }

   Request body (POST /process):
     {
       text:    "…raw text…",     // full text in one body
       srcPath: "…optional path…",// text already on the server machine
       hash:    "…caller id…",    // optional — names outputs segmented_{hash}_*
       writeSyllable: true,       // WRITE_SYLLABLE
       segmentedMode: "single",   // SEGMENTED_MODE
       debugMode:     false       // DEBUG_MODE
     }

   Auth (optional): set API_KEY env; then require  X-API-Key: <API_KEY>
   on /process. No key = open (test). Body cap: MAX_PAYLOAD_MB (256).

   Run:
     node Engine-backup/api-server.js            # port 9000 (or PORT env)
   ═══════════════════════════════════════════════════════════════ */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configure, grammarPipeline } from "./Syllable.initS.js";
import { invokeSyllableWithHash } from "../Engine/Ginit.js";
import { getDateTimeHash } from "./helper/utilities.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(MODULE_DIR, "File", ".api");
const PORT = parseInt(process.env.PORT || process.env.API_PORT || "9000", 10);
const API_KEY = process.env.API_KEY || "";
const MAX_PAYLOAD = parseInt(process.env.MAX_PAYLOAD_MB || "256", 10) * 1024 * 1024;

/* ── tiny helpers ────────────────────────────────────────────── */

function sendJson(res, status, data) {
	const body = JSON.stringify(data);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(body),
	});
	res.end(body);
}

function readJson(req) {
	return new Promise((resolve, reject) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
			if (raw.length > MAX_PAYLOAD) {
				reject(new Error(`Payload too large (max ${MAX_PAYLOAD / (1024 * 1024)} MB)`));
				req.destroy();
			}
		});
		req.on("end", () => {
			try {
				resolve(raw ? JSON.parse(raw) : {});
			} catch (err) {
				reject(new Error(`Invalid JSON: ${err.message}`));
			}
		});
		req.on("error", reject);
	});
}

function authorized(req) {
	if (!API_KEY) return true; // test mode: no key required
	return req.headers["x-api-key"] === API_KEY;
}

/* ── request handler ─────────────────────────────────────────── */

async function handleRequest(req, res) {
	const url = new URL(req.url, "http://localhost");

	if (req.method === "GET" && url.pathname === "/health") {
		return sendJson(res, 200, { ok: true, engine: "fsmgr-syllable", port: PORT });
	}

	if (req.method === "POST" && url.pathname === "/process") {
		if (!authorized(req)) {
			return sendJson(res, 403, { error: "Invalid API key" });
		}

		let body;
		try {
			body = await readJson(req);
		} catch (err) {
			return sendJson(res, 400, { error: err.message });
		}

		const { text, srcPath, ...rest } = body ?? {};
		if (!text && !srcPath) {
			return sendJson(res, 400, {
				error: "text (or srcPath) required — POST JSON to /process",
			});
		}

		/* Engine only ever writes in ITS OWN workspace (File/.output|.tree).
		   For raw `text` — whether a small sample or 6000+ pages sent in one
		   body — stage a temp input file there, then delete it. The engine
		   then reads that file through bridge/readFromApi.js (FSM stream,
		   256 KB chunks): the caller does not stream, the engine side does.
		   For srcPath — the caller (e.g. your pdf project's extracted .txt)
		   passes an absolute path; the engine reads it, never writes it. */
		let tmpFile = null;
		let input = srcPath;
		if (text) {
			try {
				fs.mkdirSync(TMP_DIR, { recursive: true });
				tmpFile = path.join(TMP_DIR, `api_${getDateTimeHash()}.txt`);
				fs.writeFileSync(tmpFile, String(text), "utf8");
				input = tmpFile;
			} catch (err) {
				return sendJson(res, 500, { error: `Stage input failed: ${err.message}` });
			}
		}

		/* Absolute caller path (pdf project) is used directly; a relative path
		   is resolved against the SERVER cwd — same machine test setup. */
		if (srcPath && !path.isAbsolute(srcPath)) {
			input = path.resolve(process.cwd(), srcPath);
		}

		try {
			/* Same flag names the CLI uses — one row per flag, no registry.
			   `hash` (optional) is the CALLER's id (server branch: submitId).
			   runMain() validates the shape (engine ts / uuid / 32-hex session)
			   and names the outputs segmented_{hash}_* — so the caller reads
			   them back with invokeWithHash(its own id). Forwarded ONLY when
			   present; without it the engine mints its own timestamp hash. */
			const pipeOpts = { srcPath: input };
			if (rest.hash !== undefined) pipeOpts.hash = rest.hash;
			configure({
				srcPath: input,
				writeSyllable: rest.writeSyllable,
				segmentedMode: rest.segmentedMode,
				debugMode: rest.debugMode,
			});
			const results = await grammarPipeline(pipeOpts);
			/* Public API returns POSITIONS, not ready-made segmented text.
			   The caller writes the segmentation itself from its own input. */
			const hash = results[0]?.hash ?? null;
			const syllable = hash ? await invokeSyllableWithHash(hash) : [];
			return sendJson(res, 200, { hash, syllable });
		} catch (err) {
			return sendJson(res, 500, { error: err.message });
		} finally {
			if (tmpFile) {
				try {
					fs.unlinkSync(tmpFile);
				} catch { /* best-effort cleanup */ }
			}
		}
	}

	return sendJson(res, 404, { error: "Not found" });
}

/* ── start ───────────────────────────────────────────────────── */

http
	.createServer((req, res) => {
		handleRequest(req, res).catch((err) => {
			console.error("[api-server] unhandled:", err);
			sendJson(res, 500, { error: err.message });
		});
	})
	.listen(PORT, "0.0.0.0", () => {
		console.log(`[api-server] listening on http://0.0.0.0:${PORT}`);
		console.log(`[api-server] POST /process  (JSON: text + flags → positions)`);
		if (API_KEY) console.log(`[api-server] auth required (X-API-Key)`);
		else console.log(`[api-server] auth: test mode (no API_KEY set)`);
	});
