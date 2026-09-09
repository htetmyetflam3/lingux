// FILE: bridge/logen.js (frontend twin — browser console only)
// Reads: nothing (browser console only)
// Processes: debug logging with %c styled output
// Outputs: colored console logs matching backend ANSI palette

const C = {
	rst: "color:inherit; background:transparent; font-weight:normal",
	bold: "font-weight:bold",
	dim: "opacity:0.6",

	// Foregrounds
	keyword: "color:#ff6b6b",
	string: "color:#98c379",
	func: "color:#e5c07b",
	var: "color:#abb2bf",
	num: "color:#61afef",
	method: "color:#56b6c2",
	op: "color:#c678dd",
	comment: "color:#5c6370",

	// Badges (black text on colored bg)
	pipe: "background:#ff79c6; color:#000; padding:1px 5px; border-radius:2px; font-weight:bold; font-size:11px",
	build:
		"background:#56b6c2; color:#000; padding:1px 5px; border-radius:2px; font-weight:bold; font-size:11px",
	read: "background:#e5c07b; color:#000; padding:1px 5px; border-radius:2px; font-weight:bold; font-size:11px",
	norm: "background:#98c379; color:#000; padding:1px 5px; border-radius:2px; font-weight:bold; font-size:11px",
	seg: "background:#e06c75; color:#000; padding:1px 5px; border-radius:2px; font-weight:bold; font-size:11px",
	bridge:
		"background:#ffffff; color:#000; padding:1px 5px; border-radius:2px; font-weight:bold; font-size:11px; border:1px solid #ccc",
	tag: "background:#c678dd; color:#000; padding:1px 5px; border-radius:2px; font-weight:bold; font-size:11px",
	walk: "background:#61afef; color:#fff; padding:1px 5px; border-radius:2px; font-weight:bold; font-size:11px",
	walkp:
		"background:#3b82f6; color:#fff; padding:1px 5px; border-radius:2px; font-weight:bold; font-size:11px",
	write:
		"background:#e5c07b; color:#000; padding:1px 5px; border-radius:2px; font-weight:bold; font-size:11px",
	rdbl: "color:#56b6c2; font-weight:bold; font-size:11px",
	comp: "color:#ff79c6; font-weight:bold; font-size:11px",
	decomp: "color:#61afef; font-weight:bold; font-size:11px",
	sys: "color:#5c6370; font-weight:bold; font-size:11px",

	ok: "color:#98c379",
	err: "color:#e06c75",
	warn: "color:#e5c07b",
	info: "color:#56b6c2",
	proc: "color:#c678dd",
};

const BADGE = {
	PIPELINE: { s: C.pipe, l: "PIPE" },
	BUILD: { s: C.build, l: "BUILD" },
	READER: { s: C.read, l: "READ" },
	NORMALIZE: { s: C.norm, l: "NORM" },
	SEGMENT: { s: C.seg, l: "SEG" },
	BRIDGE: { s: C.bridge, l: "BRIDGE" },
	TAGGER: { s: C.tag, l: "TAG" },
	WALKER: { s: C.walk, l: "WALK" },
	WALKER_POS: { s: C.walkp, l: "WALKP" },
	WRITER: { s: C.write, l: "WRITE" },
	READABLE: { s: C.rdbl, l: "RDBL" },
	COMPOSER: { s: C.comp, l: "COMP" },
	DECOMPOSER: { s: C.decomp, l: "DECOMP" },
	SYSTEM: { s: C.sys, l: "SYS" },
};

const STATUS = {
	success: C.ok,
	fail: C.err,
	error: C.err,
	processing: C.proc,
	info: C.info,
	warn: C.warn,
	skip: C.warn,
};

function ts() {
	const n = new Date();
	const d = n.toLocaleString("en-GB", {
		timeZone: "Asia/Yangon",
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	return `${d}.${String(n.getMilliseconds()).padStart(3, "0")}`;
}

function ss(v) {
	if (v instanceof Error) return v.stack || v.message || String(v);
	try {
		return JSON.stringify(v, null, 2);
	} catch {
		return "[Circular]";
	}
}

function fmt(args) {
	return args.map((a) => (typeof a === "object" ? ss(a) : String(a))).join(" ");
}

function sniffModule(txt) {
	if (txt.includes("[main.js]")) return "SYSTEM";
	if (txt.includes("[checkBtn]")) return "SYSTEM";
	return "SYSTEM";
}

function sniffLevel(args) {
	const f = String(args[0] || "");
	if (f === "ERROR:") return { level: "error", rest: args.slice(1) };
	if (f === "WARN:") return { level: "warn", rest: args.slice(1) };
	if (f === "INFO:") return { level: "info", rest: args.slice(1) };
	if (f === "SUCCESS:") return { level: "success", rest: args.slice(1) };
	return { level: "info", rest: args };
}

export function log(...args) {
	const { level, rest } = sniffLevel(args);
	const txt = rest.map((a) => String(a)).join(" ");
	const mod = sniffModule(txt);
	const b = BADGE[mod] || BADGE.SYSTEM;
	const st = STATUS[level] || C.info;

	const msgStyle =
		level === "error" ? C.err : level === "warn" ? C.warn : C.var;

	console.log(
		`%c${ts()}%c %c${b.l.padEnd(6)}%c %c${level.toUpperCase().padEnd(7)}%c %c${fmt(rest)}`,
		C.comment + "; font-size:11px",
		C.rst,
		b.s,
		C.rst,
		st + "; font-size:11px; font-weight:bold",
		C.rst,
		msgStyle,
	);
}

export function info(...a) {
	log("INFO:", ...a);
}
export function warn(...a) {
	log("WARN:", ...a);
}
export function error(...a) {
	log("ERROR:", ...a);
}
export function success(...a) {
	log("SUCCESS:", ...a);
}

export const logger = { log, info, warn, error, success };
export default logger;
