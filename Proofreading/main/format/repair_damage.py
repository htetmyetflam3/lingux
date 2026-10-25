# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Repair PDF->DOCX damage in Burmese text, using the hand-made dictionary as judge.

The supplied DOCX was converted from a PDF and the vowel signs `ေ` (U+1031) and
`ာ` (U+102C) have been attached one consonant to the left. `သဘော` never appears
in that file; `သေဘာ` appears 254 times.

    correct  သ ဘ ေ ာ      (U+101E U+1018 U+1031 U+102C)
    damaged  သ ေ ဘ ာ      (U+101E U+1031 U+1018 U+102C)

The same four characters also occur in correct Burmese -- `ရှိစေတာ့` is the
causative `စေ` followed by `တာ့` -- so the window alone decides nothing. Three
passes run in order, each one anchored on the dictionary:

  1. corrections  reviewed literal fixes for damage the window rule cannot see
                  (`ငေကာ` -> `ကြော`: the `ြ` was dropped and a `င` left behind,
                  so `ငေကာင့်`/`ငေကာင်း`/`ငေကာက်` become `ကြောင့်`/`ကြောင်း`/
                  `ကြောက်`). Listed with the number of occurrences seen in the
                  book; a different count is reported, not hidden;
  2. digits       the digit `၀` (U+1040) standing where the letter `ဝ` (U+101D)
                  belongs, repaired only when the letter makes the word real
                  (`ဘ၀` -> `ဘဝ`, `သဘာ၀` -> `သဘာဝ`);
  3. windows      `C1 ေ C2 ာ` -> `C1 C2 ေ ာ`, but only when
                    - the text is not a reviewed protected word (`ကေလာင်` pen,
                      `စေတာ` causative, `သေလား` dead-or-alive),
                    - the damaged shape occurs in no dictionary entry
                      (`စေကာ` is inside `စေ  ကာ  မူ`, so it is never touched),
                    - the text at that position is not already a real word,
                    - the repaired text is a real word, or a prefix of one that
                      ends on a syllable boundary (`မေကာင်း` -> `မကောင်း`, from
                      the entry `မ  ကောင်း  မှု`).

  Anything else is left alone and counted.

Repair passes repeat until nothing changes (`--rounds`, default 3).

Default output is a new file next to the input:
    content/source/ယဲ့နင်.txt -> content/source/ယဲ့နင်.damage-repaired.txt

Use --in-place explicitly to overwrite. --dry-run writes nothing and prints the
same report. Every line ending and every byte outside a repair is preserved.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REPO = ROOT.parents[1]
MASTER_ENC = REPO / "master.json.enc"
SECURE_JS = REPO / "secure.js"
LEDGER = HERE / "damage_ledger.json"


def _read_master(path: Path) -> dict:
    """Sealed .enc goes through repo-root secure.js (node door; the loader
    owns its .env key and sealed cache). A plain-JSON --master override is
    read directly so the override keeps working offline."""
    if str(path).endswith(".enc"):
        script = ("import {readSecureJson} from %s;"
                  "process.stdout.write(JSON.stringify(readSecureJson(%s)));"
                  % (json.dumps(str(SECURE_JS)), json.dumps(str(path.resolve()))))
        out = subprocess.run(["node", "--input-type=module", "-e", script],
                             capture_output=True, check=True, text=True).stdout
        return json.loads(out)
    return json.loads(path.read_text(encoding="utf-8"))

# Burmese base characters that can carry the displaced vowel signs.
_BASE = r"[\u1000-\u1021\u103F]"
_WINDOW = re.compile("(" + _BASE + r")(\u1031)(" + _BASE + r")(\u102C)")
_SPACES = re.compile(r"\s+")
# `၀` (digit zero) that directly follows a Burmese letter or sign.
_DIGIT = re.compile(r"[\u1000-\u103F]\u1040")
_BURMESE = re.compile(r"[\u1000-\u103F]")


def read_text(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as stream:
        return stream.read()


def write_text(path: Path, text: str) -> None:
    handle, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="") as stream:
            stream.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def collapse(value: str) -> str:
    return _SPACES.sub("", value)


class Dictionary:
    """Surface forms from the hand-made dictionary, plus syllable-boundary prefixes.

    Entries are stored with double spaces between syllables (`မ  ကောင်း  မှု`),
    which gives two useful things:

      * `forms`    -- the whole entry without spaces (`မကောင်းမှု`);
      * `prefixes` -- every prefix of an entry that ends exactly on a syllable
                      boundary (`မ`, `မကောင်း`, `မကောင်းမှု`). This is what
                      anchors words whose bare form is not an entry of its own:
                      `မကောင်း` is only ever stored inside longer entries.
    """

    def __init__(self, path: Path) -> None:
        data = _read_master(path)
        self.forms: set[str] = set()
        self.pos: dict[str, str] = {}
        self.prefixes: set[str] = set()
        for part, entries in data["dictionary"].items():
            for entry in entries:
                syllables = [collapse(piece) for piece in _SPACES.split(entry.strip()) if piece.strip()]
                if not syllables:
                    continue
                form = "".join(syllables)
                self.forms.add(form)
                self.pos.setdefault(form, part)
                growing = ""
                for syllable in syllables:
                    growing += syllable
                    self.prefixes.add(growing)
        self.maxlen = max(len(form) for form in self.forms)
        self.maxprefix = max(len(form) for form in self.prefixes)
        self._attested: dict[str, bool] = {}
        self._by_first: dict[str, set[str]] = {}
        for form in self.forms:
            self._by_first.setdefault(form[0], set()).add(form)
        self._prefix_by_first: dict[str, set[str]] = {}
        for form in self.prefixes:
            self._prefix_by_first.setdefault(form[0], set()).add(form)

    def attested(self, window: str) -> bool:
        """True when `window` occurs inside a real dictionary entry.

        `စေကာ` is not an entry, but it sits inside `စေ  ကာ  မူ`. Its shape is
        therefore ordinary Burmese and must not be rewritten.
        """
        cached = self._attested.get(window)
        if cached is None:
            cached = any(window in form for form in self.forms)
            self._attested[window] = cached
        return cached

    def word(self, text: str, index: int) -> str:
        """Longest dictionary entry starting exactly at `index`."""
        if index < 0 or index >= len(text):
            return ""
        bucket = self._by_first.get(text[index])
        if not bucket:
            return ""
        limit = min(self.maxlen, len(text) - index)
        for size in range(limit, 0, -1):
            candidate = text[index:index + size]
            if candidate in bucket:
                return candidate
        return ""

    def prefix(self, text: str, index: int) -> str:
        """Longest syllable-boundary prefix of an entry starting at `index`."""
        if index < 0 or index >= len(text):
            return ""
        bucket = self._prefix_by_first.get(text[index])
        if not bucket:
            return ""
        limit = min(self.maxprefix, len(text) - index)
        for size in range(limit, 0, -1):
            candidate = text[index:index + size]
            if candidate in bucket:
                return candidate
        return ""

    def anchor(self, text: str, index: int, minimum: int) -> str:
        """Best dictionary evidence at `index`, requiring at least `minimum` chars."""
        for evidence in (self.word(text, index), self.prefix(text, index)):
            if len(evidence) >= minimum:
                return evidence
        return ""


class Ledger:
    """Reviewed words and corrections shipped with the tool.

    `protected`  words that look damaged but are correct Burmese.
    `corrections` literal fixes for damage classes the window rule cannot see;
                  each one records how many occurrences the book had.
    """

    def __init__(self, path: Path | None) -> None:
        self.protected: list[dict] = []
        self.corrections: list[dict] = []
        self.words: list[str] = []
        if path is not None and path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            self.protected = list(data.get("protected", []))
            self.corrections = list(data.get("corrections", []))
            self.words = sorted((collapse(item["word"]) for item in self.protected), key=len, reverse=True)
        for item in self.corrections:
            item.setdefault("expected", None)
        self.corrections.sort(key=lambda item: len(item["from"]), reverse=True)

    def spans(self, text: str) -> list[tuple[int, int, str]]:
        """Every occurrence of a protected word, as (start, end, word)."""
        if not self.words:
            return []
        pattern = re.compile("|".join(re.escape(word) for word in self.words))
        return [(match.start(), match.end(), match.group(0)) for match in pattern.finditer(text)]


def _corrections(text: str, ledger: Ledger) -> tuple[str, dict, list[dict]]:
    counts: dict[str, int] = {}
    warnings: list[dict] = []
    for item in ledger.corrections:
        source, target = item["from"], item["to"]
        found = text.count(source)
        if not found:
            continue
        if item["expected"] is not None and found != item["expected"]:
            warnings.append({"from": source, "expected": item["expected"], "found": found})
        text = text.replace(source, target)
        counts[source + " -> " + target] = found
    return text, counts, warnings


def _digits(text: str, dictionary: Dictionary) -> tuple[str, dict]:
    pieces: list[str] = []
    cursor = 0
    counts: dict[str, int] = {}
    for match in _DIGIT.finditer(text):
        index = match.end() - 1          # position of the digit
        if index < cursor:
            continue
        if index + 1 < len(text) and "\u1040" <= text[index + 1] <= "\u1049":
            continue                     # part of a number such as ၁၀၀ or ၅၀%
        if index > 0 and "\u1040" <= text[index - 1] <= "\u1049":
            continue
        replaced = False
        # the word may begin right at the letter being restored (`မ၀င်` -> `မဝင်`)
        starts = [index]
        for back in range(1, 8):         # word start, at most 7 characters back
            start = index - back
            if start < 0 or not _BURMESE.match(text[start]):
                break
            starts.append(start)
        for start in starts:
            fixed = text[:index] + "\u101D" + text[index + 1:]
            gained = dictionary.word(fixed, start)
            existing = dictionary.word(text, start)
            needed = index - start
            if start == index:
                needed = 1                # require a word of at least two characters
            if gained and len(gained) > needed and len(existing) <= max(needed, 0):
                pieces.append(text[cursor:index])
                pieces.append("\u101D")
                cursor = index + 1
                key = text[max(0, index - 1):index + 1] + " -> " + fixed[max(0, index - 1):index + 1]
                counts[key] = counts.get(key, 0) + 1
                replaced = True
                break
        if replaced:
            continue
    if not pieces:
        return text, counts
    pieces.append(text[cursor:])
    return "".join(pieces), counts


def _windows(text: str, dictionary: Dictionary, ledger: Ledger) -> tuple[str, list[dict], dict]:
    spans: list[dict] = []
    skipped = {"protected": 0, "shape_is_attested": 0, "damaged_is_word": 0, "no_anchor": 0}
    protected_hits: list[dict] = []
    changed: dict[str, int] = {}
    last_end = -1
    guards = ledger.spans(text)
    guard_index = 0

    for match in _WINDOW.finditer(text):
        start, end = match.span()
        if start < last_end:
            continue
        damaged = match.group(0)
        repaired = damaged[0] + damaged[2] + damaged[1] + damaged[3]

        while guard_index < len(guards) and guards[guard_index][1] <= start:
            guard_index += 1
        if guard_index < len(guards) and guards[guard_index][0] <= start < guards[guard_index][1]:
            skipped["protected"] += 1
            protected_hits.append({"offset": start, "window": damaged, "word": guards[guard_index][2]})
            continue

        if dictionary.attested(damaged):
            skipped["shape_is_attested"] += 1
            continue

        if dictionary.anchor(text, start, len(damaged)):
            skipped["damaged_is_word"] += 1
            continue

        probe = repaired + text[end:end + max(dictionary.maxprefix, dictionary.maxlen)]
        anchor = dictionary.anchor(probe, 0, len(damaged))
        if not anchor:
            skipped["no_anchor"] += 1
            continue

        spans.append({"offset": start, "damaged": damaged, "repaired": repaired, "anchor": anchor})
        key = damaged + " -> " + repaired
        changed[key] = changed.get(key, 0) + 1
        last_end = end

    if not spans:
        return text, [], {**skipped, "changed": changed, "protected_hits": protected_hits}

    pieces: list[str] = []
    cursor = 0
    for span in spans:
        pieces.append(text[cursor:span["offset"]])
        pieces.append(span["repaired"])
        cursor = span["offset"] + len(span["damaged"])
    pieces.append(text[cursor:])

    return "".join(pieces), spans, {**skipped, "changed": changed, "protected_hits": protected_hits}


def _pass(text: str, dictionary: Dictionary, ledger: Ledger) -> tuple[str, dict]:
    text, corrections, warnings = _corrections(text, ledger)
    text, digits = _digits(text, dictionary)
    text, spans, windows = _windows(text, dictionary, ledger)
    stats = {
        "corrections": corrections,
        "digits": digits,
        "windows": windows["changed"],
        "repaired_spans": spans,
        "skipped": {key: windows[key] for key in ("protected", "shape_is_attested", "damaged_is_word", "no_anchor")},
        "protected_hits": windows["protected_hits"],
        "warnings": warnings,
        "count": sum(corrections.values()) + sum(digits.values()) + len(spans),
    }
    return text, stats


def repair(text: str, dictionary: Dictionary, ledger: Ledger | None = None,
           rounds: int = 3) -> tuple[str, dict]:
    """Run repair passes until nothing changes. Returns the text and the report."""
    ledger = ledger or Ledger(None)
    report: dict = {"rounds": [], "repairs": [], "skipped": {}, "protected_hits": [],
                    "warnings": [], "converged": False}
    totals = {"protected": 0, "shape_is_attested": 0, "damaged_is_word": 0, "no_anchor": 0}
    current = text

    for number in range(1, max(1, rounds) + 1):
        current, stats = _pass(current, dictionary, ledger)
        totals = dict(stats["skipped"])
        report["rounds"].append({
            "round": number,
            "repairs": stats["count"],
            "corrections": stats["corrections"],
            "digits": stats["digits"],
            "windows": stats["windows"],
            "skipped": stats["skipped"],
        })
        for span in stats["repaired_spans"]:
            report["repairs"].append({**span, "round": number})
        if number == 1:
            report["protected_hits"] = stats["protected_hits"]
            report["warnings"] = stats["warnings"]
        if stats["count"] == 0:
            report["converged"] = True
            break

    report["skipped"] = totals
    report["repairs_total"] = len(report["repairs"])
    report["corrections_total"] = sum(
        sum(entry["corrections"].values()) for entry in report["rounds"]
    )
    report["digits_total"] = sum(sum(entry["digits"].values()) for entry in report["rounds"])
    report["windows_total"] = sum(sum(entry["windows"].values()) for entry in report["rounds"])
    return current, report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", type=Path, help="UTF-8 text extracted from the DOCX")
    parser.add_argument("-o", "--output", type=Path, help="output path")
    parser.add_argument("--in-place", action="store_true", help="overwrite the input")
    parser.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    parser.add_argument("--report", type=Path, help="write the JSON report here")
    parser.add_argument("--rounds", type=int, default=3, help="repair passes, stops early when stable")
    parser.add_argument("--master", type=Path, default=MASTER_ENC, help=argparse.SUPPRESS)
    parser.add_argument("--ledger", type=Path, default=LEDGER, help=argparse.SUPPRESS)
    parser.add_argument("--no-ledger", action="store_true", help="ignore the reviewed word list")
    args = parser.parse_args(argv)

    if args.in_place and args.output:
        parser.error("--in-place and --output are mutually exclusive")
    if args.in_place and args.dry_run:
        parser.error("--in-place and --dry-run are mutually exclusive")

    source = args.input.resolve()
    text = read_text(source)
    dictionary = Dictionary(args.master)
    ledger = Ledger(None if args.no_ledger else args.ledger)
    repaired, report = repair(text, dictionary, ledger, rounds=args.rounds)

    print(f"[damage] dictionary forms: {len(dictionary.forms)} (prefixes {len(dictionary.prefixes)})")
    print(f"[damage] ledger: {len(ledger.words)} protected words, {len(ledger.corrections)} corrections")
    for entry in report["rounds"]:
        print(f"[damage] round {entry['round']}: {entry['repairs']} repairs "
              f"(corrections {sum(entry['corrections'].values())}, "
              f"digits {sum(entry['digits'].values())}, "
              f"windows {sum(entry['windows'].values())})")
    print(f"[damage] total: corrections {report['corrections_total']}, "
          f"digits {report['digits_total']}, windows {report['windows_total']}")
    print(f"[damage] converged: {report['converged']}")
    for phase in ("corrections", "digits", "windows"):
        for change, count in sorted(report["rounds"][0][phase].items(), key=lambda item: -item[1]):
            print(f"    {phase:<12} {count:>4}  {change}")
    print(f"[damage] skipped: {report['skipped']}")
    if report["protected_hits"]:
        print(f"[damage] protected: {sorted({hit['word'] for hit in report['protected_hits']})}")
    for warning in report["warnings"]:
        print(f"[damage] warning: expected {warning['expected']} x {warning['from']!r}, found {warning['found']}")

    if args.dry_run:
        print("[damage] dry run: nothing written")
    else:
        target = source if args.in_place else (
            args.output or source.with_name(source.stem + ".damage-repaired.txt")
        )
        write_text(target, repaired)
        print(f"[damage] wrote {target} ({len(repaired)} chars)")

    if args.report:
        args.report.write_text(
            json.dumps({"source": str(source), **report}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"[damage] report {args.report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
