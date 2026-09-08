// FILE: index.js
// Site + SPA server.
//
// Corrections for the restructured repo (paths only — everything else is the
// original logic, including the dir-creation block, kept for now):
//   1. imports: ./backend/*  -> ./Server/*        (Server/ is the backend now)
//   2. build:   npm run build runs in Site/Public/STATIC (vite + config live there)
//   3. static:  the built SPA is served from Site/Public/STATIC/frontend
//               (vite.config.js outDir, gitignored)
import 'dotenv/config';
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

import { pool } from "./Server/db/db.js";
import { createSessionMiddleware } from "./Server/db/session.js";
import { headerCheck } from "./Server/cookie/header.js";
import { cookieGenerator } from "./Server/cookie/cgen.js";
import { cookieDBCheck } from "./Server/cookie/sanitized.js";
// devbypass.js is an OPTIONAL, removable module. Delete the file and this
// import resolves to the stub below, which means the gate simply stays
// ENFORCED — nothing throws, nothing else changes. Only DEV_BYPASS_SESSION
// lives in that module; DEV_BYPASS_IP / DEV_BYPASS_HEADER / DEV_BYPASS_QUOTA
// are read straight from process.env and keep their original behaviour with
// or without it.
//
// A MISSING module is the supported case and stays silent. A BROKEN one is a
// real bug, so anything other than "devbypass.js not found" is re-thrown.
let sessionBypassBanner = () => null;
try {
  ({ sessionBypassBanner } = await import('./Server/cookie/devbypass.js'));
} catch (err) {
  const removed =
    err?.code === 'ERR_MODULE_NOT_FOUND' &&
    String(err.message).includes('devbypass');
  if (!removed) throw err;
}
import { createRequest } from "./Server/db/request.js";
import { createIncomingRouter } from "./Server/gateway/api/incoming.js";
import { createOutgoingRouter } from "./Server/gateway/api/outgoing.js";
import { createHiddenRouter } from "./Server/gateway/api/hidden.js";
import {
  LOGS_DIR,
  inputDirFor,
  ensurePraserDirs,
} from "./Public/_file/paths.js";
import {
  ACCEPTED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
} from "./Public/_file/magic.js";
import { attachSqlLogging } from "./Server/db/sqlLog.js";
import {
  createHttpConsoleLogger,
  createHttpFileLogger,
} from "./Server/log/httpLog.js";
import { createJobRegistry } from "./Server/gateway/proxy/jobs.js";

const app = express();
const PORT = process.env.PORT || 3000;

// ── Site layout (restructured repo) ────────────────────────────────────────
// Anchored to THIS FILE, not process.cwd(): Server/ moved under Site/, and the
// server must start the same way from the repo root or from Site/.
const SITE_DIR = path.dirname(fileURLToPath(import.meta.url));         // .../Site
const STATIC_DIR = path.join(SITE_DIR, "Public", "STATIC");            // build tools + vite config
const FRONTEND_DIR = path.join(STATIC_DIR, "frontend");                // vite outDir (built SPA)

// ── Directories ───────────────────────────────────────────────────────────
// All file traffic (uploads, quarantine, raw output, logs) lives inside the
// PRASER Python project — nothing is created at the repo root anymore.
import fsExtra from "fs-extra";
ensurePraserDirs();

// ── Logging ───────────────────────────────────────────────────────────────
const logStream = fs.createWriteStream(path.join(LOGS_DIR, "access.log"), { flags: "a" });
// File: plain 'combined' (no ANSI — a log file has to stay greppable).
// Console: logen's badge palette, so HTTP traffic reads as part of the same
// run as every other line the system prints. See Server/log/httpLog.js.
app.use(createHttpFileLogger(logStream));
app.use(createHttpConsoleLogger());

// ── SQL query logging ───────────────────────────────────────────────────
const sqlLogStream = fs.createWriteStream(path.join(LOGS_DIR, "sql.log"), { flags: "a" });
// ── SQL logging ─────────────────────────────────────────────────────────
// Covers pool.query AND pooled connections, so commitSubmission's transaction
// (BEGIN → submissions → quota → COMMIT) shows up too. See db/sqlLog.js.
attachSqlLogging(pool, (line) => sqlLogStream.write(line));

// ── Core middleware ─────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
  })
);

// ── Session (must be BEFORE cookieGenerator because it uses req.session.id) ─
app.use(createSessionMiddleware({
  secret: process.env.SESSION_SECRET,
  maxAge: 24 * 60 * 60 * 1000
}));

// ── Cookie generation: GLOBAL ───────────────────────────────────────────
app.use(cookieGenerator);

// ── Build SPA ───────────────────────────────────────────────────────────
function buildClient() {
  if (process.env.SKIP_BUILD === "true") {
    console.log("[build] SKIP_BUILD=true — skipping.");
    return;
  }
  try {
    console.log("[build] Running npm run build...");
    // CORRECTED: the build tools (package.json, vite, Build/vite.config.js)
    // live in Site/Public/STATIC — not at the project root.
    execSync("npm run build", { cwd: STATIC_DIR, stdio: "inherit" });
    console.log("[build] Build complete.");
  } catch (err) {
    console.error("[build] Build failed:", err.message);
    process.exit(1);
  }
}

// ── Static assets ─────────────────────────────────────────────────────────
// Serve the built SPA from Site/Public/STATIC/frontend (vite outDir)
app.use(express.static(FRONTEND_DIR));
app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

// ── CSRF token endpoint ─────────────────────────────────────────────────
app.get("/csrf-token", (req, res) => {
  const token = req.cookies.csrf_token || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  res.cookie("csrf_token", token, { httpOnly: false, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
  res.json({ csrfToken: token });
});

// ── 3-gate middleware stack: ONLY on /api ───────────────────────────────
app.use("/api", headerCheck);
app.use("/api", cookieDBCheck);

// ── Request guard (shared business logic) ────────────────────────────────
const request = createRequest({ pool });

// ── Multer upload ───────────────────────────────────────────────────────
// Uploads go straight into the PRASER python project, sorted by file type:
// .txt → upload/input/txt, .pdf → upload/input/pdf, .doc/.docx → upload/input/docx
//
// multer's job here is the ENVELOPE, not the contents: it parses the
// multipart body, caps how much of it we accept, and refuses extensions we
// have no parser for — all before a single byte is written to disk. It cannot
// tell you whether a ".pdf" is really a PDF, because it only ever sees the
// client-supplied filename and mimetype. That check is a separate step, on the
// bytes, in _file/magic.js.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, inputDirFor(file.originalname)),
    filename: (req, file, cb) =>
      cb(
        null,
        `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`,
      ),
  }),
  limits: {
    fileSize: MAX_UPLOAD_BYTES, // matches MAX_FILE_SIZE in the frontend
    files: 1,                   // one submission is one document
    fields: 10,                 // formId, text, originalName… nothing else
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      const err = new Error(
        `Unsupported file type: ${ext || "(none)"}. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}`,
      );
      err.code = "UNSUPPORTED_FILE_TYPE";
      return cb(err);
    }
    cb(null, true);
  },
});

// ── Route wiring ────────────────────────────────────────────────────────
// Extraction jobs: started by /api/submit, collected by /api/result.
// One registry, shared — two would mean the poller could never see the work.
const jobs = createJobRegistry();

const incomingRouter = createIncomingRouter({
  upload,
  pool,
  request,
  jobs,
  // fsmEndpoint / fsmKey removed — Playground no longer pushes to FSM
});

const outgoingRouter = createOutgoingRouter({
  pool,
  request,
  jobs,
});

const hiddenRouter = createHiddenRouter({
  pool,
  fsmEndpoint: process.env.FSM_ENDPOINT,
  fsmKey: process.env.FSM_KEY,
});

app.use("/api/submit", incomingRouter);
app.use("/api", outgoingRouter);
app.use("/api", hiddenRouter);   // mounts /api/process + /api/hidden/raw/:submitId

// ── Start ───────────────────────────────────────────────────────────────
buildClient();
const bypassBanner = sessionBypassBanner();
if (bypassBanner) console.warn(bypassBanner);
app.listen(PORT, "0.0.0.0", () => console.log(`Server running at http://localhost:${PORT}`));