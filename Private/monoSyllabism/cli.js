#!/usr/bin/env node

/*
 * CLI adapter only.  The engine itself stays importable and side-effect-free;
 * this file is the command-line boot path and passes the same options to it.
 *
 * Usage:
 *   node cli.js [input-file-or-directory] [writeSyllable]
 *
 * Named options are also accepted:
 *   --env path/.env   --src path   --no-syllable
 *   --readdir   --debug
 */

import { configure, grammarPipeline } from "./Syllable.initS.js";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function flag(args, yes, no) {
  if (args.includes(yes)) return true;
  if (args.includes(no)) return false;
  return undefined;
}

const args = process.argv.slice(2);
const positional = args.filter((arg, index) =>
  !arg.startsWith("--") &&
  !(index > 0 && args[index - 1].startsWith("--") &&
    ["--env", "--src"].includes(args[index - 1])),
);

const bool = (value) => value === undefined ? undefined : value !== "false";
const options = {
  envPath: valueAfter(args, "--env"),
  srcPath: valueAfter(args, "--src") ?? positional[0],
  writeSyllable: flag(args, "--syllable", "--no-syllable") ?? bool(positional[1]),
  writePos: flag(args, "--pos", "--no-pos"),
  segmentedMode: args.includes("--readdir") ? "readdir" : undefined,
  debugMode: args.includes("--debug") ? true : undefined,
};

for (const key of Object.keys(options)) {
  if (options[key] === undefined) delete options[key];
}

try {
  configure(options); // reads .env, then applies explicit CLI options
  const results = await grammarPipeline();
  const label = results.length === 1 ? "File complete" : "Batch complete";
  console.log(`\n${label}:`);
  for (const result of results) {
    const status = result.error
      ? `FAIL: ${result.error}`
      : result.text === null
        ? `OK  → syllable only`
        : `OK  → ${result.text.length} chars`;
    console.log(`  ${result.hash}: ${status}`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
