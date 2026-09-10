// FILE: map/map-loader.js
// Loader for the compiled map runtime (map-runtime.jsc).
//
// The bytecode artifact is BUILT INTO THIS SAME DIRECTORY by
// Tools/build/build-bytecode.js, so this loader resolves everything relative
// to itself — it works from any cwd and does not depend on Bridge/path.js.
//
// Repo layout: Private/monoSyllabism/mapper/map/ → 4 levels up = repo root.

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");

// bytenode registers the .jsc require handler; resolve it from the repo's
// node_modules (not the caller's cwd).
const require = createRequire(path.join(REPO_ROOT, "package.json"));
require("bytenode");

const api = require(path.join(__dirname, "map-runtime.jsc"));

export const MMap = api.MMap;
export const NewMap = api.NewMap;
export const newClause = api.newClause;
export const PUNCTUATION = api.PUNCTUATION;
export const Glue = api.Glue;
export const IMPOSTER = api.IMPOSTER;
export const Priority = api.Priority;
export const ENGLISH_DIGITS = api.ENGLISH_DIGITS;
export const BURMESE_DIGITS = api.BURMESE_DIGITS;
export const ALL_DIGITS = api.ALL_DIGITS;

export const mapperStr = api.mapperStr;
export const toBurmeseStr = api.toBurmeseStr;
export const isTail = api.isTail;
export const isBase = api.isBase;
export const isNum = api.isNum;
export const isStick = api.isStick;
export const isStandalone = api.isStandalone;

export const isLowerOrUpperAZ = api.isLowerOrUpperAZ;
export const isLowercaseAZ = api.isLowercaseAZ;
export const isUppercaseAZ = api.isUppercaseAZ;
export const compose = api.compose;
export const decompose = api.decompose;
export const burmeseTokenToAscii = api.burmeseTokenToAscii;
export const asciiTokenToBurmese = api.asciiTokenToBurmese;
export const withBraceBypass = api.withBraceBypass;

export const normalize = api.normalize;
export const MyNormalize = api.MyNormalize;

export const formatResolvedLine = api.formatResolvedLine;
export const writeResolved = api.writeResolved;
export const makeReadable = api.makeReadable;
export const getBatchSize = api.getBatchSize;
