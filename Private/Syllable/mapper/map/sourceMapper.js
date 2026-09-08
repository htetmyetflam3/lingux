import { MMap, NewMap, newClause } from "./sourceMap.js";
import { compose, decompose, burmeseTokenToAscii, asciiTokenToBurmese } from "./_function.js";

const _mmToAscii = new Map(), _asciiToMm = new Map();
function _pair(mmArr, ascArr) { mmArr.forEach((mm, i) => { _mmToAscii.set(mm, ascArr[i]); _asciiToMm.set(ascArr[i], mm); }); }
_pair(MMap.Base, NewMap.Base); _pair(MMap.Tail, NewMap.Tail); _pair(MMap.Asat, NewMap.Asat); _pair(MMap.Num, NewMap.Num);

function* iterate(str) {
  // Placeholder: yields bypass blocks or individual tokens
  let i = 0;
  while (i < str.length) {
    if (str[i] === "{") {
      const end = str.indexOf("}", i + 1);
      if (end !== -1) { yield { type: "bypass", content: str.slice(i, end + 1) }; i = end + 1; continue; }
    }
    yield { type: "token", char: str[i], index: i };
    i++;
  }
}

export function mapperStr(str) {
  // Placeholder: maps Myanmar string to ASCII tokens
  let out = "";
  for (const item of iterate(str)) {
    out += item.type === "bypass" ? item.content : (burmeseTokenToAscii(item.char, _mmToAscii) ?? item.char);
  }
  return compose(out, _asciiToMm);
}

export function toBurmeseStr(str) {
  // Placeholder: maps ASCII tokens back to Myanmar string
  const decomposed = decompose(str, _mmToAscii, _asciiToMm);
  let mm = "";
  for (const item of iterate(decomposed)) {
    mm += item.type === "bypass" ? item.content : (asciiTokenToBurmese(item.char, _asciiToMm) ?? item.char);
  }
  return mm.replace(/[{}]/g, "");
}

const _tailLookup = {};
for (const tok of NewMap.Tail) _tailLookup[tok] = "Mark";
_tailLookup[NewMap.Asat[0]] = "asat";
for (let i = 0; i < 26; i++) _tailLookup[String.fromCharCode(97 + i)] = "baseasat";

export function isTail(tok) { return _tailLookup[tok] ?? false; }
export function isBase(tok) { return NewMap.Base.includes(tok); }
export function isNum(tok) { return NewMap.Num.includes(tok); }
export function isStick(tok) { return newClause.stick.includes(tok); }
export function isStandalone(tok) { return newClause.standalone.includes(tok); }
