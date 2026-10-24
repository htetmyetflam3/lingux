# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Tag plain UTF-8 Burmese text using the owner's Engine and required rebuilt scraper WASM.

The input is the chapter text itself, one paragraph per line. No DOCX is read and
no DOCX is written. The tagged output is a UTF-8 text file with one tagger unit
per line.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "content" / "source" / "ယဲ့နင်.txt"
CHAPTER_MARKER = re.compile(r"^\[\[HCRAWLER MARKER \d+\]\]$")


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() if hasattr(
            hashlib, "file_digest"
        ) else hashlib.sha256(stream.read()).hexdigest()


def atomic_copy(source, destination):
    fd, temporary = tempfile.mkstemp(prefix=".tagged-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as out, Path(source).open("rb") as stream:
            shutil.copyfileobj(stream, out)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def prepare_text(text_path, source_path, limit):
    """Copy prose to the engine and leave HCrawler chapter markers out of tagging."""
    original = text_path.read_bytes()
    original_text = original.decode("utf-8")
    if "\x00" in original_text:
        raise ValueError("Input text contains a NUL character")

    prose_lines = []
    markers = 0
    for line in original_text.splitlines(keepends=True):
        if CHAPTER_MARKER.fullmatch(line.rstrip("\r\n")):
            markers += 1
            continue
        prose_lines.append(line)
    if limit is not None:
        prose_lines = prose_lines[:limit]
    text = "".join(prose_lines)
    raw = text.encode("utf-8")
    if not text.strip():
        raise ValueError("Input text contains no nonempty prose")
    source_path.write_bytes(raw)

    counts = Counter()
    counts["input_bytes"] = len(original)
    counts["input_chars"] = len(original_text)
    counts["input_lines"] = len(original_text.splitlines())
    counts["input_markers"] = markers
    counts["input_prose_lines"] = len(text.splitlines())
    counts["input_blank_lines"] = sum(1 for line in text.splitlines() if not line.strip())
    counts["source_bytes"] = len(raw)
    return dict(counts)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--input", type=Path, default=None,
                        help="Plain UTF-8 text; default: content/source/ယဲ့နင်.txt")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "content" / "kmt-pos")
    parser.add_argument("--max-paragraphs", type=int,
                        help="Explicit small pilot; uses a separate output name")
    args = parser.parse_args()
    if args.max_paragraphs is not None and args.max_paragraphs <= 0:
        parser.error("--max-paragraphs must be positive")

    text_path = args.input or DEFAULT_INPUT
    if args.input is None and not text_path.is_file():
        candidates = list((ROOT / "content" / "source").glob("*.txt"))
        if len(candidates) != 1:
            parser.error("Specify --input (no default text file was found)")
        text_path = candidates[0]
    text_path = text_path.resolve()
    if not text_path.is_file():
        parser.error(f"Input does not exist: {text_path}")
    if shutil.which("node") is None:
        parser.error("Node 22+ is required for the supplied Engine/WASM")

    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    stem = text_path.stem + (f"-first-{args.max_paragraphs}" if args.max_paragraphs else "")
    work = out / ".work" / stem
    work.mkdir(parents=True, exist_ok=True)
    source = work / "source.txt"
    result = work / "result.json"

    original_hash = digest(text_path)
    counts = prepare_text(text_path, source, args.max_paragraphs)
    print(
        f'[text] {counts["input_lines"]:,} lines; '
        f'{counts["input_markers"]} chapter markers skipped; original text unchanged',
        flush=True,
    )

    subprocess.run(
        ["node", "--import", str(ROOT / "scraper/wasm/box/runtime-guard.mjs"),
         str(ROOT / "Engine/tag-text.mjs"), str(source), str(work), str(result)],
        cwd=ROOT, check=True,
    )
    stats = json.loads(result.read_text())
    if digest(text_path) != original_hash:
        raise ValueError("Original text was modified")

    raw_pos = Path(stats.pop("raw_pos_path"))
    if not raw_pos.is_file() or not raw_pos.stat().st_size:
        raise ValueError("No tagged text output produced")

    outputs = {"raw_pos": out / f"{stem}.raw_pos.txt"}
    atomic_copy(raw_pos, outputs["raw_pos"])
    rejected = work / "tree/pos-fail.txt"
    if rejected.exists():
        outputs["rejected_dictionary"] = out / f"{stem}.pos-rejected.txt"
        atomic_copy(rejected, outputs["rejected_dictionary"])

    with outputs["raw_pos"].open(encoding="utf-8") as stream:
        tagged_lines = sum(1 for _ in stream)
    report = {
        **stats,
        "input_text": str(text_path.relative_to(ROOT)) if text_path.is_relative_to(ROOT) else str(text_path),
        "input_text_sha256": original_hash,
        "original_text_unchanged": True,
        "input_text_stats": counts,
        "tagged_text_sha256": digest(outputs["raw_pos"]),
        "tagged_text_bytes": outputs["raw_pos"].stat().st_size,
        "tagged_text_lines": tagged_lines,
        "tagged_text_layout": "one line per tagger unit; UTF-8 text, no DOCX output",
        "partial_pilot": args.max_paragraphs is not None,
        "outputs": {key: str(value.relative_to(out)) for key, value in outputs.items()},
    }
    report_work = work / "report.json"
    report_work.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    report_path = out / f"{stem}.report.json"
    atomic_copy(report_work, report_path)
    print(f'[done] {outputs["raw_pos"]}', flush=True)
    print(f"[report] {report_path}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"error: {error}") from error
