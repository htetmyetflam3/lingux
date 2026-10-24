#!/usr/bin/env node
/**
 * Repair PDF->DOCX damage in Burmese text, using the hand-made dictionary as judge.
 *
 * JavaScript port of format/repair_damage.py. Both files produce byte-identical
 * output for the same input; `--verify` compares them if Python is available.
 *
 * The supplied DOCX was converted from a PDF and the vowel signs `ေ` (U+1031)
 * and `ာ` (U+102C) have been attached one consonant to the left:
 *
 *     correct  သ ဘ ေ ာ      (U+101E U+1018 U+1031 U+102C)
 *     damaged  သ ေ ဘ ာ      (U+101E U+1031 U+1018 U+102C)
 *
 * The same four characters also occur in correct Burmese (`ရှိစေတာ့` is the
 * causative `စေ` plus `တာ့`), so the window alone decides nothing. Three passes
 * run in order, each anchored on the dictionary:
 *
 *   1. corrections  reviewed literal fixes for damage the window rule cannot see
 *                   (`ငေကာ` -> `ကြော`);
 *   2. digits       the digit `၀` (U+1040) where the letter `ဝ` (U+101D) belongs,
 *                   repaired only when the letter makes a real word;
 *   3. windows      `C1 ေ C2 ာ` -> `C1 C2 ေ ာ`, only when the damaged shape is in
 *                   no dictionary entry, is not already a real word, and the
 *                   repaired text is a real word or a syllable-boundary prefix.
 *
 * Passes repeat until nothing changes (--rounds, default 3).
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MASTER = resolve(ROOT, 'Engine/knowledge/isTreasure/master.json');
const LEDGER = resolve(HERE, 'damage_ledger.json');

const BASE = /[\u1000-\u1021\u103F]/;
const WINDOW = /([\u1000-\u1021\u103F])(\u1031)([\u1000-\u1021\u103F])(\u102C)/g;
const DIGIT = /[\u1000-\u103F]\u1040/g;
const BURMESE = /[\u1000-\u103F]/;

const collapse = (value) => value.replace(/\s+/g, '');

class Dictionary {
  constructor(path) {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    this.forms = new Set();
    this.prefixes = new Set();
    this.pos = new Map();
    this.byFirst = new Map();
    this.prefixByFirst = new Map();
    this.attestedCache = new Map();

    for (const [part, entries] of Object.entries(data.dictionary)) {
      for (const entry of entries) {
        const syllables = entry.trim().split(/\s+/).filter(Boolean).map(collapse);
        if (!syllables.length) continue;
        const form = syllables.join('');
        this.forms.add(form);
        if (!this.pos.has(form)) this.pos.set(form, part);
        let growing = '';
        for (const syllable of syllables) {
          growing += syllable;
          this.prefixes.add(growing);
        }
      }
    }
    this.maxlen = 0;
    for (const form of this.forms) this.maxlen = Math.max(this.maxlen, form.length);
    this.maxprefix = 0;
    for (const form of this.prefixes) this.maxprefix = Math.max(this.maxprefix, form.length);
    for (const form of this.forms) {
      const first = form[0];
      if (!this.byFirst.has(first)) this.byFirst.set(first, new Set());
      this.byFirst.get(first).add(form);
    }
    for (const form of this.prefixes) {
      const first = form[0];
      if (!this.prefixByFirst.has(first)) this.prefixByFirst.set(first, new Set());
      this.prefixByFirst.get(first).add(form);
    }
  }

  attested(window) {
    let cached = this.attestedCache.get(window);
    if (cached === undefined) {
      cached = false;
      for (const form of this.forms) {
        if (form.includes(window)) { cached = true; break; }
      }
      this.attestedCache.set(window, cached);
    }
    return cached;
  }

  word(text, index) {
    if (index < 0 || index >= text.length) return '';
    const bucket = this.byFirst.get(text[index]);
    if (!bucket) return '';
    const limit = Math.min(this.maxlen, text.length - index);
    for (let size = limit; size > 0; size -= 1) {
      const candidate = text.slice(index, index + size);
      if (bucket.has(candidate)) return candidate;
    }
    return '';
  }

  prefix(text, index) {
    if (index < 0 || index >= text.length) return '';
    const bucket = this.prefixByFirst.get(text[index]);
    if (!bucket) return '';
    const limit = Math.min(this.maxprefix, text.length - index);
    for (let size = limit; size > 0; size -= 1) {
      const candidate = text.slice(index, index + size);
      if (bucket.has(candidate)) return candidate;
    }
    return '';
  }

  anchor(text, index, minimum) {
    for (const evidence of [this.word(text, index), this.prefix(text, index)]) {
      if (evidence.length >= minimum) return evidence;
    }
    return '';
  }
}

class Ledger {
  constructor(path) {
    this.protected = [];
    this.corrections = [];
    this.words = [];
    if (path && existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      this.protected = data.protected ?? [];
      this.corrections = data.corrections ?? [];
      this.words = this.protected.map((item) => collapse(item.word)).sort((a, b) => b.length - a.length);
    }
    for (const item of this.corrections) {
      if (item.expected === undefined) item.expected = null;
    }
    this.corrections.sort((a, b) => b.from.length - a.from.length);
  }

  spans(text) {
    if (!this.words.length) return [];
    const pattern = new RegExp(this.words.map(escapeRe).join('|'), 'g');
    const out = [];
    for (const match of text.matchAll(pattern)) {
      out.push([match.index, match.index + match[0].length, match[0]]);
    }
    return out;
  }
}

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const countOf = (text, needle) => text.split(needle).length - 1;

function correctionsPass(text, ledger) {
  const counts = {};
  const warnings = [];
  for (const item of ledger.corrections) {
    const found = countOf(text, item.from);
    if (!found) continue;
    if (item.expected !== null && found !== item.expected) {
      warnings.push({ from: item.from, expected: item.expected, found });
    }
    text = text.split(item.from).join(item.to);
    counts[item.from + ' -> ' + item.to] = found;
  }
  return [text, counts, warnings];
}

function digitsPass(text, dictionary) {
  const counts = {};
  let out = '';
  let cursor = 0;
  DIGIT.lastIndex = 0;
  for (const match of text.matchAll(DIGIT)) {
    const index = match.index + match[0].length - 1;
    if (index < cursor) continue;
    const nextChar = text[index + 1] ?? '';
    const prevChar = text[index - 1] ?? '';
    if (nextChar >= '\u1040' && nextChar <= '\u1049') continue;
    if (prevChar >= '\u1040' && prevChar <= '\u1049') continue;

    const starts = [index];
    for (let back = 1; back < 8; back += 1) {
      const start = index - back;
      if (start < 0 || !BURMESE.test(text[start])) break;
      starts.push(start);
    }
    let replaced = false;
    for (const start of starts) {
      const fixed = text.slice(0, index) + '\u101D' + text.slice(index + 1);
      const gained = dictionary.word(fixed, start);
      const existing = dictionary.word(text, start);
      const needed = start === index ? 1 : index - start;
      if (gained && gained.length > needed && existing.length <= needed) {
        out += text.slice(cursor, index) + '\u101D';
        cursor = index + 1;
        const key = text.slice(Math.max(0, index - 1), index + 1) + ' -> '
          + fixed.slice(Math.max(0, index - 1), index + 1);
        counts[key] = (counts[key] ?? 0) + 1;
        replaced = true;
        break;
      }
    }
    if (replaced) continue;
  }
  if (!out) return [text, counts];
  out += text.slice(cursor);
  return [out, counts];
}

function windowsPass(text, dictionary, ledger) {
  const spans = [];
  const skipped = { protected: 0, shape_is_attested: 0, damaged_is_word: 0, no_anchor: 0 };
  const protectedHits = [];
  const changed = {};
  const guards = ledger.spans(text);
  let guardIndex = 0;
  let lastEnd = -1;

  for (const match of text.matchAll(WINDOW)) {
    const start = match.index;
    const end = start + match[0].length;
    if (start < lastEnd) continue;
    const damaged = match[0];
    const repaired = damaged[0] + damaged[2] + damaged[1] + damaged[3];

    while (guardIndex < guards.length && guards[guardIndex][1] <= start) guardIndex += 1;
    if (guardIndex < guards.length && guards[guardIndex][0] <= start && start < guards[guardIndex][1]) {
      skipped.protected += 1;
      protectedHits.push({ offset: start, window: damaged, word: guards[guardIndex][2] });
      continue;
    }
    if (dictionary.attested(damaged)) {
      skipped.shape_is_attested += 1;
      continue;
    }
    if (dictionary.anchor(text, start, damaged.length)) {
      skipped.damaged_is_word += 1;
      continue;
    }
    const probe = repaired + text.slice(end, end + Math.max(dictionary.maxprefix, dictionary.maxlen));
    const anchor = dictionary.anchor(probe, 0, damaged.length);
    if (!anchor) {
      skipped.no_anchor += 1;
      continue;
    }
    spans.push({ offset: start, length: damaged.length, damaged, repaired, anchor });
    const key = damaged + ' -> ' + repaired;
    changed[key] = (changed[key] ?? 0) + 1;
    lastEnd = end;
  }

  if (!spans.length) return [text, [], { ...skipped, changed, protected_hits: protectedHits }];

  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.offset) + span.repaired;
    cursor = span.offset + span.length;
  }
  out += text.slice(cursor);
  return [out, spans, { ...skipped, changed, protected_hits: protectedHits }];
}

function onePass(text, dictionary, ledger) {
  let counts;
  let warnings;
  let digits;
  [text, counts, warnings] = correctionsPass(text, ledger);
  [text, digits] = digitsPass(text, dictionary);
  let spans;
  let windows;
  [text, spans, windows] = windowsPass(text, dictionary, ledger);
  const stats = {
    corrections: counts,
    digits,
    windows: windows.changed,
    repaired_spans: spans,
    skipped: {
      protected: windows.protected,
      shape_is_attested: windows.shape_is_attested,
      damaged_is_word: windows.damaged_is_word,
      no_anchor: windows.no_anchor,
    },
    protected_hits: windows.protected_hits,
    warnings,
    count: sum(counts) + sum(digits) + spans.length,
  };
  return [text, stats];
}

const sum = (object) => Object.values(object).reduce((total, value) => total + value, 0);

function repair(text, dictionary, ledger, rounds = 3) {
  const report = { rounds: [], repairs: [], skipped: {}, protected_hits: [], warnings: [], converged: false };
  let current = text;
  let totals = { protected: 0, shape_is_attested: 0, damaged_is_word: 0, no_anchor: 0 };

  for (let number = 1; number <= Math.max(1, rounds); number += 1) {
    let stats;
    [current, stats] = onePass(current, dictionary, ledger);
    totals = { ...stats.skipped };
    report.rounds.push({
      round: number,
      repairs: stats.count,
      corrections: stats.corrections,
      digits: stats.digits,
      windows: stats.windows,
      skipped: stats.skipped,
    });
    for (const span of stats.repaired_spans) report.repairs.push({ ...span, round: number });
    if (number === 1) {
      report.protected_hits = stats.protected_hits;
      report.warnings = stats.warnings;
    }
    if (stats.count === 0) { report.converged = true; break; }
  }

  report.skipped = totals;
  report.repairs_total = report.repairs.length;
  report.corrections_total = report.rounds.reduce((total, entry) => total + sum(entry.corrections), 0);
  report.digits_total = report.rounds.reduce((total, entry) => total + sum(entry.digits), 0);
  report.windows_total = report.rounds.reduce((total, entry) => total + sum(entry.windows), 0);
  return [current, report];
}

function usage() {
  return `usage: node repair_damage.mjs <input.txt> [options]

  -o, --output <path>   output path (default: <input>.damage-repaired.txt)
      --in-place        overwrite the input
      --dry-run         report only, write nothing
      --report <path>   write the JSON report
      --rounds <n>      repair passes, stops early when stable (default 3)
      --no-ledger       ignore the reviewed word list
      --ledger <path>   reviewed word list (default: damage_ledger.json)
      --master <path>   dictionary (default: Engine/knowledge/isTreasure/master.json)
      --verify <path>   compare the result with another program's output
  -h, --help            show this help`;
}

function parseArgs(argv) {
  const args = { input: null, output: null, inPlace: false, dryRun: false, report: null,
    rounds: 3, noLedger: false, ledger: LEDGER, master: MASTER, verify: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') { console.log(usage()); process.exit(0); }
    else if (arg === '-o' || arg === '--output') args.output = argv[++index];
    else if (arg === '--report') args.report = argv[++index];
    else if (arg === '--rounds') args.rounds = Number(argv[++index]);
    else if (arg === '--ledger') args.ledger = argv[++index];
    else if (arg === '--master') args.master = argv[++index];
    else if (arg === '--verify') args.verify = argv[++index];
    else if (arg === '--in-place') args.inPlace = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--no-ledger') args.noLedger = true;
    else if (arg.startsWith('-')) { console.error(`unknown option ${arg}\n\n${usage()}`); process.exit(2); }
    else args.input = arg;
  }
  if (!args.input) { console.error(usage()); process.exit(2); }
  if (args.inPlace && args.output) { console.error('--in-place and --output are mutually exclusive'); process.exit(2); }
  if (args.inPlace && args.dryRun) { console.error('--in-place and --dry-run are mutually exclusive'); process.exit(2); }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = resolve(args.input);
  const text = readFileSync(source, 'utf8');
  const dictionary = new Dictionary(resolve(args.master));
  const ledger = new Ledger(args.noLedger ? null : resolve(args.ledger));
  const [repaired, report] = repair(text, dictionary, ledger, args.rounds);

  console.log(`[damage] dictionary forms: ${dictionary.forms.size} (prefixes ${dictionary.prefixes.size})`);
  console.log(`[damage] ledger: ${ledger.words.length} protected words, ${ledger.corrections.length} corrections`);
  for (const entry of report.rounds) {
    console.log(`[damage] round ${entry.round}: ${entry.repairs} repairs `
      + `(corrections ${sum(entry.corrections)}, digits ${sum(entry.digits)}, windows ${sum(entry.windows)})`);
  }
  console.log(`[damage] total: corrections ${report.corrections_total}, `
    + `digits ${report.digits_total}, windows ${report.windows_total}`);
  console.log(`[damage] converged: ${report.converged}`);
  for (const phase of ['corrections', 'digits', 'windows']) {
    const entries = Object.entries(report.rounds[0][phase]).sort((a, b) => b[1] - a[1]);
    for (const [change, count] of entries) {
      console.log(`    ${phase.padEnd(12)} ${String(count).padStart(4)}  ${change}`);
    }
  }
  console.log(`[damage] skipped: ${JSON.stringify(report.skipped)}`);
  if (report.protected_hits.length) {
    console.log(`[damage] protected: ${JSON.stringify([...new Set(report.protected_hits.map((hit) => hit.word))])}`);
  }
  for (const warning of report.warnings) {
    console.log(`[damage] warning: expected ${warning.expected} x ${JSON.stringify(warning.from)}, found ${warning.found}`);
  }

  if (args.verify) {
    const other = readFileSync(resolve(args.verify), 'utf8');
    if (other !== repaired) {
      console.error('[damage] verify: output differs');
      process.exit(1);
    }
    console.log('[damage] verify: output identical');
  }

  if (args.dryRun) {
    console.log('[damage] dry run: nothing written');
  } else {
    const target = args.inPlace ? source
      : resolve(args.output ?? source.slice(0, source.length - extname(source).length) + '.damage-repaired.txt');
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, repaired, 'utf8');
    renameSync(temporary, target);
    console.log(`[damage] wrote ${target} (${repaired.length} chars)`);
  }

  if (args.report) {
    writeFileSync(resolve(args.report), JSON.stringify({ source, ...report }, null, 2), 'utf8');
    console.log(`[damage] report ${resolve(args.report)}`);
  }
  return 0;
}

process.exit(main());
