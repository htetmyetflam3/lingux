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
import morgan from "morgan";
import path from "path";
import fs from "fs";
import util from "util";
import crypto from "crypto";
import multer from "multer";
import { execSync } from "child_process";

import { pool } from "./Server/db/db.js";
import { createSessionMiddleware } from "./Server/db/session.js";
import { headerCheck } from "./Server/cookie/header.js";
import { cookieGenerator } from "./Server/cookie/cgen.js";
import { cookieDBCheck } from "./Server/cookie/sanitized.js";
import { createRequest } from "./Server/db/request.js";
import { createIncomingRouter } from "./Server/gateway/api/incoming.js";
import { createOutgoingRouter } from "./Server/gateway/api/outgoing.js";
import { createHiddenRouter } from "./Server/gateway/api/hidden.js";
import {
  LOGS_DIR,
  inputDirFor,
  ensurePraserDirs,
} from "./Public/_file/paths.js";
import { sessionBypassBanner } from "./Server/cookie/devbypass.js";

const app = express();
const PORT = process.env.PORT || 3000;
const projectRoot = process.cwd();

// ── Dev bypass banner ────────────────────────────────────────────────────
// Loud one-liner whenever DEV_BYPASS_SESSION is set: active in dev, ignored
// in production (see Server/cookie/devbypass.js).
const bypassBanner = sessionBypassBanner();
if (bypassBanner) console.log(bypassBanner);

// ── Site layout (restructured repo) ────────────────────────────────────────
const STATIC_DIR = path.join(projectRoot, "Site", "Public", "STATIC"); // build tools + vite config
const FRONTEND_DIR = path.join(STATIC_DIR, "frontend");                // vite outDir (built SPA)

// ── Directories ───────────────────────────────────────────────────────────
// All file traffic (uploads, quarantine, raw output, logs) lives inside the
// PRASER Python project — nothing is created at the repo root anymore.
import fsExtra from "fs-extra";
ensurePraserDirs();

// ── Logging ───────────────────────────────────────────────────────────────
const logStream = fs.createWriteStream(path.join(LOGS_DIR, "access.log"), { flags: "a" });
app.use(morgan("combined", { stream: logStream }));
app.use(morgan("dev"));

// ── SQL query logging ───────────────────────────────────────────────────
const sqlLogStream = fs.createWriteStream(path.join(LOGS_DIR, "sql.log"), { flags: "a" });
const originalQuery = pool.query.bind(pool);
pool.query = async function (sql, values, ...rest) {
  const timestamp = new Date().toISOString();
  const sqlStr = typeof sql === "string" ? sql : sql?.sql || "[prepared]";
  sqlLogStream.write(`[${timestamp}] SQL: ${sqlStr}\n`);
  if (values !== undefined) sqlLogStream.write(`[${timestamp}] Values: ${util.inspect(values)}\n`);
  return originalQuery(sql, values, ...rest);
};

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
const UPLOAD_MAX_MB = Number.parseInt(process.env.UPLOAD_MAX_MB || '64', 10);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, inputDirFor(file.originalname)),
    filename: (req, file, cb) =>
      cb(
        null,
        `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`,
      ),
  }),
  // the Site only SHUTTLES bytes to the praser — it never opens them, but
  // the door still has a size: bombs die before the quarantine write
  limits: { fileSize: UPLOAD_MAX_MB * 1024 * 1024 },
});

// ── Route wiring ────────────────────────────────────────────────────────
const incomingRouter = createIncomingRouter({
  upload,
  pool,
  request,
  // fsmEndpoint / fsmKey removed — Playground no longer pushes to FSM
});

const outgoingRouter = createOutgoingRouter({
  pool,
  request,
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
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));