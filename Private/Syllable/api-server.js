#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   api-server.js — minimal HTTP wrapper around the engine

   The public API does NOT hand back ready-made segmented text. It hands
   back POSITIONS and the caller writes the segmentation into its OWN
   original string. See Grule/Ginit.js → invokeSyllableWithHash().

   Zero extra dependencies (native node:http).

   Endpoints:
     GET  /health   → { ok: true } — liveness, open
     POST /fsm      → hidden.js delivers the submission metadata into the
                      pre-receive cache (holds ≥20 records, TTL). THE KEYED
                      ENDPOINT: X-API-Key + IP + origin gate. With fileUrl
                      and no sha the engine PULLS the raw txt and computes
                      the expectations itself.
     POST /metadata → the PDF-praser side declares its metadata. NO key —
                      accepted blindly; the metadata IS the key here: it is
                      cross-checked against the hidden-delivered record.
                      Misaligned → 403, record burned, the text body never
                      crosses.
     POST /process  → { hash, syllable: [ { index, syllable: [...] } ] }
                      the text (body) or the pull signal (empty text +
                      delivered fileUrl). MUST align with the hidden-
                      delivered record or 403; burns on first arrival.

   Request body (POST /process):
     {
       text:    "…raw text…",     // full text in one body
       srcPath: "…optional path…",// text already on the server machine
       hash:    "…caller id…",    // optional — names outputs segmented_{hash}_*
       writeSyllable: true,       // WRITE_SYLLABLE
       segmentedMode: "single",   // SEGMENTED_MODE
       debugMode:     false       // DEBUG_MODE
     }

   Auth (handshake gate — fail closed): the KEY validates the hidden.js
   → engine connection (POST /fsm): X-API-Key matching the root .env key
   (FSM_KEY / ENGINE_KEY / API_KEY), a caller IP on the allowlist and,
   when the caller sends Origin/Referer, a host on the origin allowlist.
   No key configured = the engine refuses everything. The praser-side
   endpoints (/metadata, /process) are deliberately UNKEYED — the praser
   has no key; their validation is the hidden-delivered metadata itself.
   /health is open. Body cap: MAX_PAYLOAD_MB (256).

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

/* ── hidden-delivered metadata — strong validator, no chaining ─
   The metadata cache is filled ONLY by hidden.js (POST /fsm, keyed):
   the trusted DB side tells the engine, ahead of time, what each
   submission must look like — filename, userId, sessionId, formId,
   sha256, byte length (≥20 records held; TTL-bounded). When the
   PDF-praser side connects it is accepted BLINDLY (no key) and its
   metadata is CROSS-CHECKED against the delivered record. Anything
   that does not align — or arrives with no delivered record at all —
   is rejected (403) and the record is burned before any text is
   processed. One delivered record = at most one accepted push.

   Expectations come from hidden (or from the raw txt the engine
   itself pulls via fileUrl) — never from the caller being checked. */
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

/* Pull the raw txt the way hidden planned it: the engine fetches the
   Site's raw endpoint (hidden serves it under the SAME key), buffers the
   bytes and decodes ONCE — then hands it to the normal staging path,
   where bridge/readFromApi.js (FSM stream, \n-boundary yields) does the
   actual file reading. Fail closed: a failed pull caches nothing. */
async function pullRawText(fileUrl) {
	const res = await fetch(fileUrl, {
		headers: { "X-API-Key": API_KEY },
		signal: AbortSignal.timeout(30000),
	});
	if (!res.ok) throw new Error(`pull ${res.status} from raw endpoint`);
	const buf = Buffer.from(await res.arrayBuffer());
	return buf.toString("utf8");
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

	/* ── POST /fsm — hidden.js delivers the metadata (KEYED) ───────
	   The trusted DB side tells the engine, ahead of time, what the
	   submission must look like. This is the ONLY endpoint that may
	   create a cache record, and it sits behind the full handshake
	   gate (key + IP + origin). Payload = hidden.js's exact shape
	   (fileName, fileUrl, status …) + optional textSha256/textBytes.
	   With fileUrl and no sha the engine pulls the raw txt NOW and
	   computes the expectations from the authoritative file. */
	if (req.method === "POST" && url.pathname === "/fsm") {
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
		const records = body.records ?? [body];
		const stored = [];
		for (const b of records) {
			const record = {
				submitId: b.submitId,
				filename: b.filename || b.fileName,
				userId: b.userId,
				sessionId: b.sessionId,
				formId: b.formId,
				source: b.source ?? null,
				originalName: b.originalName ?? b.originalFileName ?? null,
				status: b.status ?? null,
				fileUrl: b.fileUrl ?? null,
				textSha256: b.textSha256 ?? null,
				textBytes: b.textBytes ?? null,
				receivedAt: Date.now(),
			};
			const required = ["submitId", "filename", "userId", "sessionId", "formId"];
			const missing = required.filter(
				(k) => record[k] === undefined || record[k] === null || record[k] === "",
			);
			if (missing.length) {
				return sendJson(res, 400, {
					error: `/fsm missing required validators: ${missing.join(", ")}`,
				});
			}
			if (!hashKind(record.submitId)) {
				return sendJson(res, 400, { error: "/fsm: unusable submitId shape" });
			}
			if (!String(record.filename).startsWith(String(record.submitId))) {
				return sendJson(res, 400, {
					error:
						"/fsm: filename is not the frontend-created name ({submitId}{ext})",
				});
			}
			if ((record.textSha256 === null || record.textSha256 === undefined) && record.fileUrl) {
				// No sha delivered — pull the raw txt and compute it. The
				// expectation comes from the file itself, not the caller.
				try {
					const pulled = await pullRawText(record.fileUrl);
					record.textSha256 = sha256Hex(pulled);
					record.textBytes = Buffer.byteLength(pulled, "utf8");
				} catch (err) {
					return sendJson(res, 502, {
						error: `/fsm: raw pull failed for ${record.submitId}: ${err.message}`,
					});
				}
			}
			if (record.textSha256 === null || record.textSha256 === undefined || record.textBytes === null || record.textBytes === undefined) {
				return sendJson(res, 400, {
					error: "/fsm: needs textSha256+textBytes or a pullable fileUrl",
				});
			}
			storePreReceived(record);
			stored.push(record.submitId);
		}
		return sendJson(res, 200, {
			stored: stored.length,
			submitIds: stored,
			pending: PRE_RECEIVED.size,
		});
	}

	/* ── POST /metadata — the praser side declares (BLIND, NO key) ─
	   The praser has no key: this endpoint accepts the call blindly
	   and the metadata itself is the key. It is cross-checked against
	   the record hidden delivered (/fsm). Misaligned → 403 + burn, so
	   the /process text body never crosses. Aligned → the record is
	   KEPT for the one push it authorises. */
	if (req.method === "POST" && url.pathname === "/metadata") {
		let body;
		try {
			body = await readJson(req);
		} catch (err) {
			return sendJson(res, 400, { error: err.message });
		}
		const claimed = {
			submitId: body.submitId,
			filename: body.filename || body.fileName,
			userId: body.userId,
			sessionId: body.sessionId,
			formId: body.formId,
			textSha256: body.textSha256,
			textBytes: body.textBytes,
		};
		const required = [
			"submitId", "filename", "userId", "sessionId",
			"formId", "textSha256", "textBytes",
		];
		const missing = required.filter(
			(k) => claimed[k] === undefined || claimed[k] === null || claimed[k] === "",
		);
		if (missing.length) {
			return sendJson(res, 400, {
				error: `declare missing required validators: ${missing.join(", ")}`,
			});
		}
		if (!hashKind(claimed.submitId)) {
			return sendJson(res, 400, { error: "declare: unusable submitId shape" });
		}
		const rec = takePreReceived(claimed.submitId);
		if (!rec) {
			return sendJson(res, 403, {
				error:
					"rejected: no hidden-delivered metadata for this id — hidden must POST /fsm first",
			});
		}
		const mism = [];
		if (claimed.filename !== rec.filename) mism.push("filename");
		if (String(claimed.userId) !== String(rec.userId)) mism.push("userId");
		if (claimed.sessionId !== rec.sessionId) mism.push("sessionId");
		if (String(claimed.formId) !== String(rec.formId)) mism.push("formId");
		if (claimed.textSha256 !== rec.textSha256) mism.push("textSha256");
		if (Number(claimed.textBytes) !== Number(rec.textBytes)) mism.push("textBytes");
		if (mism.length) {
			// burned: a poisoned declare kills the record — nothing honest
			// can be pushed under it afterwards (one-shot, tamper-proof)
			PRE_RECEIVED.delete(claimed.submitId);
			return sendJson(res, 403, {
				error: `rejected: declared metadata does not align with hidden-delivered record (${mism.join(", ")})`,
			});
		}
		return sendJson(res, 200, { verified: true, submitId: claimed.submitId });
	}

	if (req.method === "POST" && url.pathname === "/process") {
		let body;
		try {
			body = await readJson(req);
		} catch (err) {
			return sendJson(res, 400, { error: err.message });
		}

		const { text, srcPath, ...rest } = body ?? {};

		/* ── alignment gate (NO key — the record IS the validator) ───
		   The push must align with the metadata hidden delivered for
		   this id: filename, userId, sessionId, sha256, byte length.
		   Anything that does not align is rejected and the record is
		   burned — one delivery authorises at most one push.
		   Pull mode: an empty body text + a delivered fileUrl means
		   "encoding finished" — the engine pulls the raw txt itself
		   (hidden serves it under the same key) and validates it
		   against the delivered sha/bytes. srcPath pushes are engine-
		   local and still require a live record. */
		const rec = rest.hash ? takePreReceived(rest.hash) : null;
		let processText = text ?? null;
		if (processText === null && !srcPath && rec?.fileUrl) {
			try {
				processText = await pullRawText(rec.fileUrl);
			} catch (err) {
				PRE_RECEIVED.delete(rest.hash);
				return sendJson(res, 502, {
					error: `engine raw pull failed: ${err.message}`,
				});
			}
		}
		if (processText === null && !srcPath) {
			return sendJson(res, 400, {
				error: "text (or srcPath) required — POST JSON to /process",
			});
		}
		if (processText !== null) {
			if (!rec) {
				return sendJson(res, 403, {
					error:
						"rejected: no hidden-delivered metadata for this id — hidden must POST /fsm first",
				});
			}
			const mism = [];
			if ((rest.filename || rest.fileName) !== rec.filename) mism.push("filename");
			if (String(rest.userId) !== String(rec.userId)) mism.push("userId");
			if (rest.sessionId !== rec.sessionId) mism.push("sessionId");
			if (sha256Hex(String(processText)) !== rec.textSha256) mism.push("textSha256");
			if (Buffer.byteLength(String(processText), "utf8") !== rec.textBytes)
				mism.push("textBytes");
			// burned either way: tampered or replayed pushes get nothing
			PRE_RECEIVED.delete(rest.hash);
			if (mism.length) {
				return sendJson(res, 403, {
					error: `rejected: push does not align with hidden-delivered metadata (${mism.join(", ")})`,
				});
			}
		}
		const text_ = processText;

		/* Engine only ever writes in ITS OWN workspace (File/.output|.tree).
		   For raw `text` — whether a small sample or 6000+ pages sent in one
		   body — stage a temp input file there, then delete it. The engine
		   then reads that file through bridge/readFromApi.js (FSM stream,
		   256 KB chunks): the caller does not stream, the engine side does.
		   For srcPath — the caller (e.g. your pdf project's extracted .txt)
		   passes an absolute path; the engine reads it, never writes it. */
		let tmpFile = null;
		let input = srcPath;
		if (text_) {
			try {
				fs.mkdirSync(TMP_DIR, { recursive: true });
				tmpFile = path.join(TMP_DIR, `api_${getDateTimeHash()}.txt`);
				fs.writeFileSync(tmpFile, String(text_), "utf8");
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
				`[api-server] handshake gate FAIL-CLOSED — no key in env/.env; /fsm refuses everything`,
			);
		}
	});
