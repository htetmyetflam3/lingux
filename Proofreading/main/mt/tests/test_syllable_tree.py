"""The syllable tree: both lists present, every dictionary entry reachable.

These tests guard the defect that made Pali invisible to the segmentor. The
builder streamed master.json line by line and stopped at the end of the first
list, so `syllables.pali` (732 units — `ဒ္ဓ`, `န္ဓာ`, `က္က`, `ဋ္ဌ`) never reached
the tree. Every Pali dictionary entry was pruned at build time and
`ဗုဒ္ဓ` segmented as `ဗု · ဒ · ္ဓ`.
"""
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "mt"))

import lexicon  # noqa: E402

MASTER = ROOT / "Engine/knowledge/isTreasure/master.json"
CACHE = ROOT / "Engine/.cache-tree"
SOURCE = ROOT / "Engine/CACHE-SOURCE.json"
LOADER = ROOT / "Engine/MonoSyllabism/main/grapheme/Tree.loaded.js"

PALI_UNITS = ("ဒ္ဓ", "န္ဓာ", "က္က", "က္ခ", "ဋ္ဌ", "မ္ဘ", "န္တ")


class TreeCache(unittest.TestCase):
    def test_mapped_table_has_pali_units(self):
        text = (CACHE / "syllable.mapped.txt").read_text(encoding="utf-8")
        for unit in PALI_UNITS:
            self.assertIn(f'"{unit}"', text, unit)
        self.assertGreater(len(text.splitlines()), 3000)

    def test_every_dictionary_entry_is_reachable(self):
        reachable, unreachable, _units = lexicon._tables()
        self.assertEqual(unreachable, {}, "entries blocked by units missing from the tree")
        self.assertGreater(len(reachable), 29_000)

    def test_pali_dictionary_entry_is_reachable(self):
        result = lexicon.lookup("ဗုဒ္ဓ")
        self.assertTrue(result["in_dictionary"])
        self.assertTrue(result["reachable"])

    def test_recorded_hashes_match_the_files(self):
        import hashlib
        source = json.loads(SOURCE.read_text(encoding="utf-8"))
        for name, expected in source["sha256"].items():
            digest = hashlib.sha256((CACHE / name).read_bytes()).hexdigest()
            self.assertEqual(digest, expected, name)

    def test_source_records_where_the_tree_came_from(self):
        source = json.loads(SOURCE.read_text(encoding="utf-8"))
        self.assertEqual(source["counts"]["pali"], 732)
        self.assertEqual(source["counts"]["burmese"], 2483)


class Loader(unittest.TestCase):
    """The builder's loader, run for real. Needs node, like the engine does."""

    def setUp(self):
        if not shutil.which("node"):
            self.skipTest("node not on PATH")

    def test_loader_yields_both_lists(self):
        script = (
            "const {loadSyllablesData} = await import(process.argv[1]);\n"
            f"const l = await loadSyllablesData({json.dumps(str(MASTER))});\n"
            "console.log(JSON.stringify({n: l.length, first: l[0], at: l[2483]}));\n"
        )
        proc = subprocess.run([shutil.which("node"), "--input-type=module", "-e", script,
                               str(LOADER)],
                              capture_output=True, text=True, timeout=120,
                              cwd=str(ROOT))
        self.assertEqual(proc.returncode, 0, proc.stderr[-800:])
        payload = json.loads(proc.stdout.strip().splitlines()[-1])
        self.assertEqual(payload["n"], 3215)
        self.assertEqual(payload["first"], "၎င်း")   # burmese first: ids stay put
        self.assertEqual(payload["at"], "တ္တား")     # pali appended after it


if __name__ == "__main__":
    unittest.main()
