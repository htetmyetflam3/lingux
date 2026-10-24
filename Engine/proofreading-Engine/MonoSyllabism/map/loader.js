// Production map API: EVERY algorithm call goes into the rebuilt scraper WASM.
// The four mapbuilder/base files are build/test inputs only. No JSC/JS fallback.
import { getBox } from '../../../scraper/wasm/box/host.mjs';
const box = getBox();
const tables = box.call('tables');
export const MMap = tables.MMap;
export const NewMap = tables.NewMap;
export const newClause = tables.newClause;
export const IMPOSTER = tables.IMPOSTER;
export const Priority = tables.Priority;
export const PUNCTUATION = new Set(tables.PUNCTUATION);
export const ALL_DIGITS = new Set(tables.ALL_DIGITS);
export const BLOCK_PUNCT = new Set(tables.BLOCK_PUNCT);
export const Glue = new Set(tables.Glue);
export const BURMESE_DIGITS = new Set(tables.BURMESE_DIGITS);
export const ENGLISH_DIGITS = new Set(tables.ENGLISH_DIGITS);

// Cache only observed WASM results; no duplicate implementation of the helpers.
function cached(method) {
  const cache = new Map();
  return text => {
    if (cache.has(text)) return cache.get(text);
    const value = box.call(method, text);
    if (typeof text === 'string' && text.length <= 128) {
      if (cache.size >= 10000) cache.clear();
      cache.set(text, value);
    }
    return value;
  };
}
export const normalize = text => box.call('normalize', text);
export const mapperNormalize = text => box.call('mapperNormalize', text);
export const MyNormalize = text => box.call('myNormalize', text);
export const myNormalize = MyNormalize;
export const mapperStr = text => box.call('mapperStr', text);
export const toBurmeseStr = cached('toBurmeseStr');
export const isTail = cached('isTail');
export const isBase = cached('isBase');
export const isNum = cached('isNum');
export const isStick = cached('isStick');
export const isStandalone = cached('isStandalone');
export const isLowerOrUpperAZ = cached('isLowerOrUpperAZ');
export const isLowercaseAZ = cached('isLowercaseAZ');
export const isUppercaseAZ = cached('isUppercaseAZ');
export default mapperNormalize;
