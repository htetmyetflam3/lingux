// helper/build.js
import fs from 'fs';
import readline from 'readline';
import { DataFile } from '../../Bridge/path.js';
import { readSecureText } from '../../Bridge/secure.js';

export function getStep(rootNode, stepNum) {
  const key = `St-${stepNum}`;
  if (!rootNode[key]) rootNode[key] = [];
  return rootNode[key];
}

export function finalizeRootSteps(rootNode) {
  const steps = Object.keys(rootNode)
    .filter((k) => k.startsWith('St-') && k !== 'St-F')
    .sort((a, b) => parseInt(a.replace('St-', '')) - parseInt(b.replace('St-', '')));

  const maxStep = steps.pop();
  if (maxStep && maxStep !== 'St-F') {
    rootNode['St-F'] = rootNode[maxStep];
    delete rootNode[maxStep];
  }

  const sorted = {};
  Object.keys(rootNode)
    .sort((a, b) => {
      if (a === 'St-F') return 1;
      if (b === 'St-F') return -1;
      return parseInt(a.replace('St-', '')) - parseInt(b.replace('St-', ''));
    })
    .forEach((k) => (sorted[k] = rootNode[k]));

  Object.assign(rootNode, sorted);
}

function _extractSyllables(text) {
  const syllables = [];
  let inSyllables = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!inSyllables) {
      if (/^"syllables"\s*:\s*\[\s*$/.test(trimmed)) inSyllables = true;
      continue;
    }
    if (trimmed === ']' || trimmed.startsWith('],')) break;
    const match = line.match(/^\s*("(?:\\.|[^"\\])*")/);
    if (match) syllables.push(JSON.parse(match[1]));
  }
  return syllables;
}

export async function streamSyllables(jsonPath) {
  // If an encrypted <file>.enc exists, decrypt instead of streaming plaintext.
  if (fs.existsSync(jsonPath + '.enc')) {
    const text = readSecureText(jsonPath);
    return _extractSyllables(text);
  }
  const fileStream = fs.createReadStream(jsonPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const syllables = [];
  let inSyllables = false;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!inSyllables) {
      if (/^"syllables"\s*:\s*\[\s*$/.test(trimmed)) inSyllables = true;
      continue;
    }
    if (trimmed === ']' || trimmed.startsWith('],')) break;
    const match = line.match(/^\s*("(?:\\.|[^"\\])*")/);
    if (match) syllables.push(JSON.parse(match[1]));
  }

  return syllables;
}

export async function loadSyllablesData(jsonPath = DataFile() + '/master.json') {
  const syllables = await streamSyllables(jsonPath);
  if (!syllables.length) throw new Error(`No syllables found in ${jsonPath}`);
  return syllables;
}
