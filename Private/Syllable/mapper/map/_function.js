import { MMap, NewMap } from './sourceMap.js';
const LOWER_A = 'a'.charCodeAt(0), LOWER_Z = 'z'.charCodeAt(0);
const UPPER_A = 'A'.charCodeAt(0), UPPER_Z = 'Z'.charCodeAt(0);

export function isLowerOrUpperAZ(char) {
  if (typeof char !== 'string' || char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return (code >= LOWER_A && code <= LOWER_Z) || (code >= UPPER_A && code <= UPPER_Z);
}

export function isLowercaseAZ(char) {
  if (typeof char !== 'string' || char.length !== 1) return false;
  return char.charCodeAt(0) >= LOWER_A && char.charCodeAt(0) <= LOWER_Z;
}

export function isUppercaseAZ(char) {
  if (typeof char !== 'string' || char.length !== 1) return false;
  return char.charCodeAt(0) >= UPPER_A && char.charCodeAt(0) <= UPPER_Z;
}

export function compose(str, asciiToMm) {
  // Placeholder: composes ASCII markers into Myanmar characters
  const baseSet = new Set(NewMap.Base);
  return str.replace(
    /([A-Z])\^\$|\$([A-Z])|\$([a-z])|\$([^A-Za-z])|([A-Z])\^/g,
    (match, upperE, upperDollar, lowerDollar, otherDollar, upper) => {
      if (upperE) return upperE + '#';
      if (upperDollar || lowerDollar || otherDollar) {
        const asc = upperDollar || lowerDollar || otherDollar;
        return baseSet.has(asc) ? (asciiToMm.get(asc) ?? match) : match;
      }
      if (upper) return String.fromCharCode(upper.charCodeAt(0) + 32);
      return match;
    }
  );
}

export function decompose(str, mmToAscii, asciiToMm) {
  // Placeholder: decomposes Myanmar back to ASCII tokens
  const myanmarBaseSet = new Set(MMap.Base);
  return withBraceBypass(str, (ch) => {
    if (ch === '#') return '^$';
    if (isLowercaseAZ(ch)) return String.fromCharCode(ch.charCodeAt(0) - 32) + '^';
    if (myanmarBaseSet.has(ch)) return '\u1039' + ch;
    return ch;
  });
}

export function burmeseTokenToAscii(token, mmToAscii) {
  // Placeholder: maps single Myanmar char to ASCII
  return mmToAscii.get(token) ?? null;
}

export function asciiTokenToBurmese(token, asciiToMm) {
  // Placeholder: maps single ASCII token to Myanmar char
  return asciiToMm.get(token) ?? null;
}

export function withBraceBypass(str, transformFn) {
  // Placeholder: applies transform only outside { } braces
  let out = '', i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '{') {
      const end = str.indexOf('}', i + 1);
      if (end !== -1) { out += str.slice(i, end + 1); i = end + 1; continue; }
// FILE: _function.js
    }
    if (ch === '}') { out += ch; i++; continue; }
    out += transformFn(ch, i);
    i++;
  }
  return out;
}
