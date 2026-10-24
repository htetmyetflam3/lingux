/**
 * Rabbit Zawgyi -> Unicode, as a SEAM.
 *
 * The rule table is the official one; the Python side embeds it verbatim
 * (module/rabbit.py). Here it is read from model/zg2uni-rules.json, which
 * .bin/gen-praser-data.py extracts from that same Python source — so the table
 * can never drift from what the praser is ported against.
 *
 * Set PRASER_RABBIT_MODULE to an installed npm package that exports
 * { zg2uni } (or a default with .zg2uni) and it wins; this file exists so the
 * pipeline has one call site either way.
 *
 * One Python/JS regex difference is handled here rather than left to chance:
 * Python's `$` also matches immediately before a trailing newline, JS's does not.
 * Rule "([^\\u1040-\\u1049])\u1040$" therefore gets an explicit `(?=\n?$)` so
 * page text that ends in "\n" converts identically.
 */
import fs from "node:fs";
import path from "node:path";
import { MAP_DIR } from "./paths.mjs";

const RULES_PATH = path.join(MAP_DIR, "zg2uni-rules.json");

function pyReplToJs(to) {
  // Python \N backrefs -> JS $N; a literal $ in a replacement must be escaped.
  return to.replace(/\$/g, "$$").replace(/\\(\d)/g, "$$$1");
}

function adaptSource(src) {
  // Python `$` == JS `$` except for one optional trailing newline.
  if (src.endsWith("$") && !src.endsWith("\\$")) return `${src.slice(0, -1)}(?=\n?$)`;
  return src;
}

function compileLocal() {
  const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  return rules.map((r) => [new RegExp(adaptSource(r.from), "u"), pyReplToJs(r.to)]);
}

let compiled = null;
let external = null;

async function load() {
  if (external !== null) return external;
  const mod = process.env.PRASER_RABBIT_MODULE;
  if (mod) {
    const imported = await import(mod);
    const fn = imported.zg2uni ?? imported.default?.zg2uni;
    if (typeof fn !== "function") {
      throw new TypeError(`${mod} does not export a zg2uni function`);
    }
    external = { external: true, fn };
    return external;
  }
  compiled = compiled ?? compileLocal();
  external = {
    external: false,
    fn: (text) => {
      for (const [rx, to] of compiled) text = text.replace(new RegExp(rx.source, "gu"), to);
      return text;
    },
  };
  return external;
}

export class Rabbit {
  static zg2uni(text) {
    if (external === null) {
      // The pipeline is synchronous; a missing seam means the caller must await
      // initRabbit() once at startup (prase.mjs does).
      if (compiled === null) compiled = compileLocal();
      for (const [rx, to] of compiled) text = text.replace(new RegExp(rx.source, "gu"), to);
      return text;
    }
    return external.fn(text);
  }
}

export async function initRabbit() {
  await load();
  return { external: external.external };
}

/** Number of rules actually applied — a parity check against rabbit.py's 118. */
export function ruleCount() {
  if (compiled === null) compiled = compileLocal();
  return compiled.length;
}
