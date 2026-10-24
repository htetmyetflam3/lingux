#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Audit the crawled Chinese source: what chapters it really has.

The crawl is a web scrape, and it shows: chapter titles are sometimes glued onto
the end of a body line, sometimes repeated as a page header
(`第二百六十九卓: 風中許下的諾言.5/7`), sometimes mangled by OCR
(`第八十一章: 我背刺了我自己？ 5/` for chapter 61). Numbers not recognized by
this parser are reported as parsing gaps, not proof that source text is absent.

This answers, in one screen and without reading the 4 MB file:

- every chapter number the crawl holds, and its title
- which numbers this parser cannot recognize as standalone starts (not proof of absence)
- which headings are page headers masquerading as chapter starts
- whether any number is parsed more than once (and therefore which body a
  `--chapters` request would actually get)

    python3 tools/audit_source.py                      # summary, one screen
    python3 tools/audit_source.py --titles --from 194   # title table for a range
    python3 tools/audit_source.py --json                # for a script or agent
    python3 tools/audit_source.py --check 194-408       # is this range safe?

Exit codes: 0 clean, 1 the range has holes, 2 bad request, 4 unreadable source.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "mt"))

from translate import (  # noqa: E402
    CHINESE,
    _CN_TITLE,
    _CN_241_TITLE,
    _cn_label,
    chinese_chapters,
)

_MARKER = re.compile(r"^\[\[KMTCRAWLER MARKER \d+\]\]$")
_RANGE = re.compile(r"^\s*(\d+)\s*[-–]\s*(\d+)\s*$")


def scan(path: Path = CHINESE) -> dict:
    """Everything the source says about its own chapters, in one pass."""
    lines = path.read_text(encoding="utf-8").split("\n")
    headings: list[dict] = []
    for index, raw in enumerate(lines):
        stripped = raw.strip()
        if not stripped or _MARKER.match(stripped):
            continue
        if stripped.startswith("====="):
            title = stripped.strip("= ").strip()
            match = _CN_TITLE.search(title)
            bare = re.fullmatch(r"\d+", title)
            number = (_cn_label(match.group(1)) if match
                      else int(bare.group()) if bare else None)
            if number is not None:
                headings.append({"line": index + 1, "number": number,
                                 "title": title, "form": "heading"})
            continue
        # A chapter title inside a body line: the web page's running header.
        for match in _CN_TITLE.finditer(stripped):
            headings.append({"line": index + 1,
                             "number": _cn_label(match.group(1)),
                             "title": match.group(0).strip(),
                             "form": "inline"})
        for match in _CN_241_TITLE.finditer(stripped):
            headings.append({"line": index + 1, "number": 241,
                             "title": match.group(0).strip(), "form": "inline"})
    chapters = chinese_chapters(path)
    present = sorted({chapter.number for chapter in chapters})
    counts = Counter(chapter.number for chapter in chapters)
    last = max(present) if present else 0
    # An inline heading is either the chapter's ONLY heading (the crawler glued a
    # real title onto the previous line) or a running page header repeating a
    # chapter already open. Only the first kind is a boundary.
    on_heading_lines = {h["number"] for h in headings if h["form"] == "heading"}
    inline_numbers = {h["number"] for h in headings if h["form"] == "inline"}
    return {
        "source": str(path),
        "lines": len(lines),
        "headings": len(headings),
        "inline_headings": sum(1 for h in headings if h["form"] == "inline"),
        "inline_only": sorted(inline_numbers - on_heading_lines),
        "inline_repeats": sum(1 for h in headings
                              if h["form"] == "inline"
                              and h["number"] in on_heading_lines),
        "parsed_chapters": len(chapters),
        "present": present,
        "last": last,
        "missing": [n for n in range(1, last + 1) if n not in set(present)],
        "duplicates": {n: k for n, k in counts.items() if k > 1},
        "out_of_order": sum(1 for a, b in zip(present, present[1:]) if b < a),
        "titles": {chapter.number: chapter.title for chapter in chapters},
        "heading_rows": headings,
    }


def range_from(text: str | None, audit: dict) -> tuple[int, int]:
    if text:
        match = _RANGE.match(text)
        if not match:
            raise ValueError(f"--check wants LOW-HIGH, not {text!r}")
        return int(match.group(1)), int(match.group(2))
    return 194, audit["last"]


def report(audit: dict, low: int, high: int) -> dict:
    have = set(audit["present"])
    inside = [n for n in range(low, high + 1) if n in have]
    holes = [n for n in range(low, high + 1) if n not in have]
    return {
        "range": [low, high],
        "chapters": len(inside),
        "holes": holes,
        "first": inside[0] if inside else None,
        "last": inside[-1] if inside else None,
        "duplicated_inside": {n: k for n, k in audit["duplicates"].items()
                              if low <= n <= high},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="What the crawled Chinese source really contains.")
    parser.add_argument("--source", type=Path, default=CHINESE)
    parser.add_argument("--titles", action="store_true",
                        help="print the chapter-title table instead of the summary")
    parser.add_argument("--from", dest="start", type=int, default=None, metavar="N")
    parser.add_argument("--to", dest="stop", type=int, default=None, metavar="N")
    parser.add_argument("--check", metavar="LOW-HIGH", default=None,
                        help="report the holes in a range, e.g. 194-408")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    if not args.source.is_file():
        print(f"[audit] no source at {args.source}", file=sys.stderr)
        return 4
    audit = scan(args.source)

    if args.check:
        try:
            low, high = range_from(args.check, audit)
        except ValueError as error:
            print(f"[audit] {error}", file=sys.stderr)
            return 2
        found = report(audit, low, high)
        if args.json:
            print(json.dumps(found, indent=2, ensure_ascii=False))
        else:
            print(f"[audit] {low}-{high}: {found['chapters']} chapter(s), "
                  f"first {found['first']}, last {found['last']}")
            if found["holes"]:
                print(f"[audit] numbers not recognized as standalone chapter starts: {found['holes']}")
        return 1 if found["holes"] else 0

    if args.titles:
        low = args.start if args.start is not None else 1
        high = args.stop if args.stop is not None else audit["last"]
        rows = [{"number": n, "title": audit["titles"].get(n, "")}
                for n in sorted(audit["titles"]) if low <= n <= high]
        if args.json:
            print(json.dumps(rows, indent=2, ensure_ascii=False))
        else:
            for row in rows:
                print(f"{row['number']:>4}  {row['title'][:74]}")
        return 0

    summary = {key: audit[key] for key in
               ("source", "lines", "parsed_chapters", "headings",
                "inline_headings", "inline_only", "inline_repeats",
                "last", "missing", "duplicates", "out_of_order")}
    if args.json:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return 0
    print(f"[audit] {audit['source']}")
    print(f"[audit] {audit['parsed_chapters']} chapter(s) parsed from "
          f"{audit['lines']:,} lines; last number {audit['last']}")
    print(f"[audit] {audit['headings']} heading candidate(s): "
          f"{audit['headings'] - audit['inline_headings']} on '=====' lines, "
          f"{audit['inline_headings']} glued into body text")
    if audit["inline_only"]:
        print(f"[audit] glued headings that are a chapter's ONLY start "
              f"({len(audit['inline_only'])}): {audit['inline_only'][:12]}"
              f"{' …' if len(audit['inline_only']) > 12 else ''}")
    if audit["inline_repeats"]:
        print(f"[audit] glued headings that just repeat a chapter already open "
              f"(page headers): {audit['inline_repeats']}")
    if audit["missing"]:
        print(f"[audit] numbers not recognized as chapter starts: {audit['missing']}")
    if audit["duplicates"]:
        worst = ", ".join(f"{n}×{k}" for n, k in
                          sorted(audit["duplicates"].items())[:12])
        print(f"[audit] numbers parsed more than once: {worst}")
        print("[audit] a request for those numbers gets the longest body "
              "(see api_translate.select)")
    print(f"[audit] titles: python3 tools/audit_source.py --titles "
          f"--from 194 --to {audit['last']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
