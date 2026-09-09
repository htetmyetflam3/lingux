#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   api-server.js — minimal HTTP wrapper around the engine

   The public API does NOT hand back ready-made segmented text. It hands
   back POSITIONS and the caller writes the segmentation into its OWN
   original string. See Grule/Ginit.js → invokeSyllableWithHash().

   Zero extra dependencies (native node:http).

   Endpoints:
     GET  /health   → { ok: true }
     POST /metadata → pre-receive: register the submission's validators
                      (filename, userId, sessionId, formId, textSha256,
                      textBytes) — no text crosses this endpoint
     POST /process  → { hash, syllable: [ { index, syllable: [...] } ] }
                      body-text pushes MUST align with the pre-received
                      metadata or they are rejected (403)

   Request body (POST /process):
     {
       text:    "…raw text…",     // full text in one body
       srcPath: "…optional path…",// text already on the server machine
       hash:    "…caller id…",    // optional — names outputs segmented_{hash}_*
       writeSyllable: true,       // WRITE_SYLLABLE
       segmentedMode: "single",   // SEGMENTED_MODE
       debugMode:     false       // DEBUG_MODE
     }

   Auth (handshake gate — fail closed): /metadata and /process require
   X-API-Key matching the root .env key (FSM_KEY / ENGINE_KEY / API_KEY),
   a caller IP on the allowlist (loopback + DEV_BYPASS_IP entries) and,
   when the caller sends Origin/Referer, a host on the origin allowlist.
   No key configured = the engine refuses everything. /health is open.
   Body cap: MAX_PAYLOAD_MB (256).

   Run:
     node Engine-backup/api-server.js            # port 9000 (or PORT env)
   ═══════════════════════════════════════════════════════════════ */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { configure, grammarPipeline } from "./Syllable.initS.js";
import { invokeSyllableWithHash, hashKind } from "../Engine/Ginit.js";
import { getDateTimeHash } from "./helper/utilities.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(MODULE_DIR, "File", ".api");
const PORT = parseInt(process.env.PORT || process.env.API_PORT || "9000", 10);
const MAX_PAYLOAD = parseInt(process.env.MAX_PAYLOAD_MB || "256", 10) * 1024 * 1024;

/* ── handshake gate — key + caller IP + origin, fail closed ────
   "Key validating must exist before handshake success": the key is the
   one from the root .env (the same FSM_KEY the Site bridge sends). The
   engine resolves it at boot and refuses /metadata + /process unless
   ALL of these hold:
     1. X-API-Key equals the configured key (timing-safe compare). If the
        engine has NO key configured it rejects everything — a gate that
        cannot validate must not open.
     2. Caller IP (socket) is allow-listed. Dev placeholders: loopback +
        every DEV_BYPASS_IP entry from .env (ENGINE_ALLOWED_IPS overrides).
     3. Origin/Referer, when the caller sends one, resolves to a host on
        the origin allowlist (dev placeholder: localhost:3000 via
        ENGINE_ALLOWED_ORIGINS). Server-to-server fetches send neither —
        key + IP still gate them. /health stays open (liveness only). */
const ROOT_ENV = path.resolve(MODULE_DIR, "..", "..", ".env");

/* .env reader that KEEPS duplicate keys as arrays (DEV_BYPASS_IP is listed
   more than once in the file — every entry is a valid dev IP). */
function readEnvFileMulti(p) {
	const out = {};
	try {
		for (const line of fs.readFileSync(p, "utf8").split("\n")) {
			const t = line.trim();
			if (!t || t.startsWith("#") || t.startsWith("//")) continue;
			const eq = t.indexOf("=");
			if (eq === -1) continue;
			const k = t.slice(0, eq).trim();
			const v = t.slice(eq + 1).trim();
			if (!(k in out)) out[k] = v;
			else if (Array.isArray(out[k])) out[k].push(v);
			else out[k] = [out[k], v];
		}
	} catch {
		/* no .env — process env only */
	}
	return out;
}

const FILE_ENV = readEnvFileMulti(ROOT_ENV);
const asList = (v) =>
	v === undefined || v === null || v === ""
		? []
		: (Array.isArray(v) ? v : [v])
				.flatMap((x) => String(x).split(","))
				.map((x) => x.trim())
				.filter(Boolean);
const firstOf = (env, k) => {
	const v = env[k];
	return Array.isArray(v) ? v[0] : v;
};

const API_KEY =
	process.env.API_KEY ||
	process.env.ENGINE_KEY ||
	firstOf(FILE_ENV, "ENGINE_KEY") ||
	firstOf(FILE_ENV, "FSM_KEY") ||
	"";

const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
/* Explicit ENGINE_ALLOWED_IPS wins verbatim (the operator decides, even if
   that excludes loopback). Otherwise: .env DEV_BYPASS_IP entries + loopback. */
const ALLOWED_IPS = new Set(
	process.env.ENGINE_ALLOWED_IPS
		? asList(process.env.ENGINE_ALLOWED_IPS)
		: [
				...asList(FILE_ENV.DEV_BYPASS_IP),
				...asList(FILE_ENV.ENGINE_ALLOWED_IPS),
				...LOOPBACK,
			],
);
const ALLOWED_ORIGINS = new Set(
	process.env.ENGINE_ALLOWED_ORIGINS
		? asList(process.env.ENGINE_ALLOWED_ORIGINS)
		: firstOf(FILE_ENV, "ENGINE_ALLOWED_ORIGINS")
			? asList(firstOf(FILE_ENV, "ENGINE_ALLOWED_ORIGINS"))
			: ["localhost:3000", "localhost", "127.0.0.1:3000"],
);

function timingSafeEq(a, b) {
	const ba = Buffer.from(String(a), "utf8");
	const bb = Buffer.from(String(b), "utf8");
	if (ba.length !== bb.length) return false;
	return crypto.timingSafeEqual(ba, bb);
}

function originHost(req) {
	const raw = req.headers.origin || req.headers.referer || "";
	if (!raw) return null; // server-to-server fetch: no domain header sent
	try {
		return new URL(raw).host;
	} catch {
		return String(raw).replace(/^https?:\/\//, "").split("/")[0];
	}
}

function gate(req) {
	// 1) key — the handshake does not exist without it
	if (!API_KEY) {
		return { ok: false, reason: "rejected: engine has no API key configured (fail closed)" };
	}
	if (!timingSafeEq(req.headers["x-api-key"] || "", API_KEY)) {
		return { ok: false, reason: "rejected: API key missing or wrong" };
	}
	// 2) caller IP — socket address, not spoofable headers
	const ip = req.socket?.remoteAddress || "";
	const ipOk = [...ALLOWED_IPS].some((a) => ip === a || ip === "::ffff:" + a);
	if (!ipOk) {
		return { ok: false, reason: "rejected: caller ip not allowed" };
	}
	// 3) domain — validated when the caller actually sends one
	const host = originHost(req);
	if (host !== null && ![...ALLOWED_ORIGINS].some((a) => host === a)) {
		return { ok: false, reason: "rejected: origin/domain not allowed" };
	}
	return { ok: true };
}

/* ── pre-received metadata — strong validator, no chaining ─────
   The Site registers the submission metadata HERE (POST /metadata)
   BEFORE any PDF/docx text arrives — the same pre-receive the hidden
   /api/process flow performs in production. A body-text push that does
   not align with the pre-received record — submitId, filename,
   userId, sessionId, sha256, byte length — is REJECTED (403) and the
   record is burned. One record = at most one accepted push.

   The Python PRASER never calls the engine. Only the Site bridge
   talks to it, and only through this gate. */
const PRE_RECEIVED = new Map();
const PRE_RECEIVED_MAX = parseInt(process.env.PRE_RECEIVED_MAX || "500", 10);
const PRE_RECEIVED_TTL_MS = parseInt(
	process.env.PRE_RECEIVED_TTL_MS || String(10 * 60 * 1000),
	10,
);

function sha256Hex(s) {
	return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function storePreReceived(record) {
	// TTL prune on insert; the cap bounds memory regardless
	const now = Date.now();
	for (const [id, rec] of PRE_RECEIVED) {
		if (now - rec.receivedAt > PRE_RECEIVED_TTL_MS) PRE_RECEIVED.delete(id);
	}
	while (PRE_RECEIVED.size >= PRE_RECEIVED_MAX) {
		PRE_RECEIVED.delete(PRE_RECEIVED.keys().next().value);
	}
	PRE_RECEIVED.set(record.submitId, record);
}

function takePreReceived(submitId) {
	const rec = PRE_RECEIVED.get(submitId);
	if (!rec) return null;
	if (Date.now() - rec.receivedAt > PRE_RECEIVED_TTL_MS) {
		PRE_RECEIVED.delete(submitId);
		return null;
	}
	return rec;
}

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
		/* Accumulate BUFFERS and decode once — decoding per chunk corrupts
		   any multi-byte char split across a TCP boundary. The sha/byte
		   validators exist precisely to catch this class of silent damage. */
		const chunks = [];
		let total = 0;
		req.on("data", (chunk) => {
			total += chunk.length;
			if (total > MAX_PAYLOAD) {
				reject(new Error(`Payload too large (max ${MAX_PAYLOAD / (1024 * 1024)} MB)`));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				const raw = Buffer.concat(chunks).toString("utf8");
				resolve(raw ? JSON.parse(raw) : {});
			} catch (err) {
				reject(new Error(`Invalid JSON: ${err.message}`));
			}
		});
		req.on("error", reject);
	});
}

/* ── request handler ─────────────────────────────────────────── */

async function handleRequest(req, res) {
	const url = new URL(req.url, "http://localhost");

	if (req.method === "GET" && url.pathname === "/health") {
		return sendJson(res, 200, { ok: true, engine: "fsmgr-syllable", port: PORT });
	}

	/* ── POST /metadata — the pre-receive gate ─────────────────────
	   Registers what a text push for this submitId MUST look like:
	   the frontend-created filename, the caller's userId and session
	   cookie identity (validators, not options), and the expected
	   text sha256 + byte length. No text crosses this endpoint. */
	if (req.method === "POST" && url.pathname === "/metadata") {
		const g = gate(req);
		if (!g.ok) {
			return sendJson(res, 403, { error: g.reason });
		}
		let body;
		try {
			body = await readJson(req);
		} catch (err) {
			return sendJson(res, 400, { error: err.message });
		}
		const record = {
			submitId: body.submitId,
			filename: body.filename || body.fileName,
			userId: body.userId,
			sessionId: body.sessionId,
			formId: body.formId,
			source: body.source ?? null,
			originalName: body.originalName ?? body.originalFileName ?? null,
			textSha256: body.textSha256,
			textBytes: body.textBytes,
			receivedAt: Date.now(),
		};
		const required = [
			"submitId", "filename", "userId", "sessionId",
			"formId", "textSha256", "textBytes",
		];
		const missing = required.filter(
			(k) => record[k] === undefined || record[k] === null || record[k] === "",
		);
		if (missing.length) {
			return sendJson(res, 400, {
				error: `pre-receive missing required validators: ${missing.join(", ")}`,
			});
		}
		if (!hashKind(record.submitId)) {
			return sendJson(res, 400, { error: "pre-receive: unusable submitId shape" });
		}
		if (!String(record.filename).startsWith(String(record.submitId))) {
			return sendJson(res, 400, {
				error:
					"pre-receive: filename is not the frontend-created name ({submitId}{ext})",
			});
		}
		storePreReceived(record);
		return sendJson(res, 200, { received: true, submitId: record.submitId });
	}

	if (req.method === "POST" && url.pathname === "/process") {
		const g = gate(req);
		if (!g.ok) {
			return sendJson(res, 403, { error: g.reason });
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

		/* ── alignment gate: body-text pushes (the PDF/docx path) ────
		   Must align with the metadata pre-received for this id:
		   filename, userId, sessionId, sha256, byte length. Anything
		   that does not align is rejected and the record is burned —
		   one pre-receive authorises at most one push. srcPath pushes
		   are engine-local (a file already on THIS machine) and do
		   not pass through this gate. */
		if (text) {
			const rec = rest.hash ? takePreReceived(rest.hash) : null;
			if (!rec) {
				return sendJson(res, 403, {
					error:
						"rejected: no pre-received metadata for this id — register it via POST /metadata first",
				});
			}
			const mism = [];
			if ((rest.filename || rest.fileName) !== rec.filename) mism.push("filename");
			if (String(rest.userId) !== String(rec.userId)) mism.push("userId");
			if (rest.sessionId !== rec.sessionId) mism.push("sessionId");
			if (sha256Hex(String(text)) !== rec.textSha256) mism.push("textSha256");
			if (Buffer.byteLength(String(text), "utf8") !== rec.textBytes)
				mism.push("textBytes");
			// burned either way: tampered or replayed pushes get nothing
			PRE_RECEIVED.delete(rest.hash);
			if (mism.length) {
				return sendJson(res, 403, {
					error: `rejected: push does not align with pre-received metadata (${mism.join(", ")})`,
				});
			}
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
		if (API_KEY) {
			console.log(
				`[api-server] handshake gate ON — key ${API_KEY.slice(0, 6)}…(${API_KEY.length} chars) from ${
					process.env.API_KEY || process.env.ENGINE_KEY ? "env" : ".env"
				}, ips: ${[...ALLOWED_IPS].join(" ")}, origins: ${[...ALLOWED_ORIGINS].join(" ")}`,
			);
		} else {
			console.log(
				`[api-server] handshake gate FAIL-CLOSED — no key in env/.env; /metadata + /process refuse everything`,
			);
		}
	});
