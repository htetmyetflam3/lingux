// Scratch shim standing in for map/loader.js (sealed V8 bytecode + bytenode)
// and map/secure.js. Identical surface, sourced from the readable
// mapbuilder/base/ modules + knowledge/isTreasure/master.json instead.
//
// THIS FILE IS NOT IN GIT. The runtime imports the sealed map/loader.js,
// which needs `bytenode` to read the encrypted payload; this shim exposes
// the same names from the readable sources so the segmentor can run
// without it. fetch-mono-tree.sh writes it into MonoSyllabism/map/.
export {
  isTail,
  isBase,
  toBurmeseStr,
  mapperStr,
  isNum,
  isStick,
  isStandalone,
} from "../mapbuilder/base/sourceMapper.js";
export { isLowercaseAZ } from "../mapbuilder/base/function.js";
export { normalize, myNormalize, mapperNormalize } from "../mapbuilder/base/normalize.js";
// mapbuilder/base/sourceMap.js is deliberately NOT re-exported: it declares
// ENGLISH_DIGITS twice (const + export list), which is a hard parse error.
// Nothing the segmentor uses needs it -- only phonology.js (POS) does.
// MyNormalize is what the sealed loader called the Myanmar -> ASCII mapper+normaliser.
export { myNormalize as MyNormalize } from "../mapbuilder/base/normalize.js";
