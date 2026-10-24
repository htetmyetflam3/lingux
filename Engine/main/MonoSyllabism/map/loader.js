// FILE: loader.js — wasm-backed map runtime.
//
// Same import path and export names as the old bytenode loader, so every
// engine consumer (input.js, lexer.js, phonology.js, formatter.js,
// disassembler.js) stays byte-unchanged. The backing artifact is now
// box.wasm — QuickJS compiled to WASM — booted through ./host.mjs. No
// bytenode, no V8-version coupling, no key in this file: host.mjs decrypts
// the payload with PAYLOAD_KEY (env) or ./payload.key.txt beside it.
//
// Build-only names (compose, decompose, burmeseTokenToAscii,
// asciiTokenToBurmese, withBraceBypass, cleanImposters, reorderAndWrap,
// deleteEnglishBlocks) are not exported: no engine runtime module imports
// them. compose still runs at runtime, wrapped inside the in-box normalize
// pipeline (the packed sourceMapper bundles it).
import { getBox } from './host.mjs';

const box = getBox();
const call = (method, ...args) => box.call(method, ...args);
const tables = box.call('tables');

// ── functions (engine-api methods) ──
export const normalize = (...a) => call('normalize', ...a);
export const mapperNormalize = (...a) => call('mapperNormalize', ...a);
export const myNormalize = (...a) => call('myNormalize', ...a);
export const MyNormalize = myNormalize; // contract name the old loader exported
export const mapperStr = (...a) => call('mapperStr', ...a);
export const toBurmeseStr = (...a) => call('toBurmeseStr', ...a);
export const isTail = (...a) => call('isTail', ...a);
export const isBase = (...a) => call('isBase', ...a);
export const isNum = (...a) => call('isNum', ...a);
export const isStick = (...a) => call('isStick', ...a);
export const isStandalone = (...a) => call('isStandalone', ...a);
export const isLowerOrUpperAZ = (...a) => call('isLowerOrUpperAZ', ...a);
export const isLowercaseAZ = (...a) => call('isLowercaseAZ', ...a);
export const isUppercaseAZ = (...a) => call('isUppercaseAZ', ...a);

// ── table constants ──
export const MMap = tables.MMap;
export const NewMap = tables.NewMap;
export const newClause = tables.newClause;
export const IMPOSTER = tables.IMPOSTER;
export const Priority = tables.Priority;
export const BLOCK_PUNCT = tables.BLOCK_PUNCT;
export const ALL_DIGITS = tables.ALL_DIGITS;
export const PUNCTUATION = tables.PUNCTUATION;
export const Glue = tables.Glue;
export const BURMESE_DIGITS = tables.BURMESE_DIGITS;
export const ENGLISH_DIGITS = tables.ENGLISH_DIGITS;

// Old loader contract: default = mapperNormalize.
export default mapperNormalize;
