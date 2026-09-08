#!/usr/bin/env bash
# FILE: Tools/test/bench-sylbreak.sh
#
# Head-to-head benchmark: lingux Engine vs sylbreak (ye-kyaw-thu), the
# standard regex-based Burmese syllable segmenter.
#
#   https://github.com/ye-kyaw-thu/sylbreak
#
# Measures four things on identical input:
#   1. speed          — pure syllable segmentation, 3 runs each
#   2. agreement      — do the two tools cut at the same boundaries?
#   3. Zawgyi input   — the case real Burmese PDFs actually present
#   4. adversarial    — a 20,000-char tail, the disk/CPU spam vector
#
# The comparison is deliberately UNFAIR TO LINGUX on speed: sylbreak does
# segmentation only, while the lingux run also builds trees and POS-tags.
# Read the speed row as "segmentation alone", the rest as "what each tool
# can actually do".
#
# Usage:  bash Tools/test/bench-sylbreak.sh
# Needs:  python3, node, git, and network access on first run.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${BENCH_WORK:-/tmp/lingux-bench}"
SYL="$WORK/sylbreak"
PDF="$ROOT/Site/Public/PRASER/Python/upload/input/pdf/test.pdf"
PRASER="$ROOT/Site/Public/PRASER/Python"

mkdir -p "$WORK"

# ── the Engine expects its own deployment layout; bridge it, never repoint
#    the constants (Site and Engine deploy separately by design) ──
scaffold() {
  mkdir -p "$ROOT/ENGINE/Part/Engine" \
           "$ROOT/PDF/Python/File/input" \
           "$ROOT/PDF/Python/File/.output/txt" \
           "$ROOT/PDF/Python/File/.output/.log" \
           "$ROOT/PDF/Python/File/.tree"
  ln -sfn "$ROOT/Private/Engine/_knowledge" "$ROOT/ENGINE/Part/Engine/_knowledge"
}
unscaffold() { rm -rf "$ROOT/ENGINE" "$ROOT/PDF"; }
trap unscaffold EXIT

now() { python3 -c 'import time;print(time.time())'; }
el()  { python3 -c "print(f'{$2-$1:.3f}')"; }

echo "════════ setup ════════"
[ -d "$SYL" ] || git clone -q https://github.com/ye-kyaw-thu/sylbreak.git "$SYL"
echo "  sylbreak: $(cd "$SYL" && git rev-parse --short HEAD)"

if [ ! -f "$WORK/book.txt" ]; then
  ( cd "$PRASER" && python3 module/prase.py "$PDF" "$WORK/book.txt" --cleanup no >/dev/null 2>&1 )
fi
echo "  corpus  : $(wc -l < "$WORK/book.txt") lines, $(wc -c < "$WORK/book.txt") bytes (764-page PDF)"

echo
echo "════════ 1. speed — syllable segmentation ════════"
for i in 1 2 3; do
  s=$(now); python3 "$SYL/python/sylbreak.py" -i "$WORK/book.txt" -o "$WORK/syl.txt"; e=$(now)
  echo "  sylbreak run $i: $(el "$s" "$e") s"
done

scaffold
cp "$WORK/book.txt" "$ROOT/PDF/Python/File/input/input.txt"
rm -f "$ROOT/PDF/Python/File/.output/txt/"*.txt
s=$(now); ( cd "$ROOT" && timeout 900 node Private/Syllable/cli.js PDF/Python/File/input/input.txt > "$WORK/lingux.log" 2>&1 ); e=$(now)
echo "  lingux full pipeline: $(el "$s" "$e") s  (tree build + segment + POS + write)"
sed 's/\x1b\[[0-9;]*m//g' "$WORK/lingux.log" | grep -E "PROGRESS|SEGMENTOR\] Done" | tail -3 | sed 's/^/    /'

LSYL=$(ls "$ROOT/PDF/Python/File/.output/txt/"*syllable.txt 2>/dev/null | head -1)
cp "$LSYL" "$WORK/lingux_syl.txt" 2>/dev/null

echo
echo "════════ 2. boundary agreement ════════"
# Compare boundaries ONLY, on identical text. lingux normalises its input, so
# feeding both tools the raw file compares different strings and reports a
# meaningless 0%. Instead: reconstruct lingux's normalised text from its own
# output, run sylbreak on THAT, then compare unit lists.
python3 - "$SYL" "$WORK" <<'PY2'
import re, subprocess, sys
syl_dir, work = sys.argv[1], sys.argv[2]
lin = [l.rstrip('\n') for l in open(f'{work}/lingux_syl.txt', encoding='utf-8')]
units = [[u for u in re.sub(r'\{[^}]*\}', '', l).split() if u] for l in lin]
open(f'{work}/norm.txt', 'w', encoding='utf-8').write('\n'.join(''.join(u) for u in units) + '\n')
subprocess.run(['python3', f'{syl_dir}/python/sylbreak.py',
                '-i', f'{work}/norm.txt', '-o', f'{work}/norm_syl.txt'], check=True)
syl = [l.rstrip('\n') for l in open(f'{work}/norm_syl.txt', encoding='utf-8')]

BUR = lambda s: any('\u1000' <= c <= '\u109f' for c in s) and all(
    '\u1000' <= c <= '\u109f' or c.isspace() or c in '\u104a\u104b' for c in s)
DIAC = set('\u1037\u103a\u103b\u103c\u103d\u103e\u1031\u102d\u102e\u102f\u1030\u1032\u1036')
tot = same = lin_more = syl_more = other = 0
ex_l, ex_s = [], []
for x, y in zip(syl, units):
    ax = [u for u in re.split(r'[|\s]+', x) if u]
    if not ax or ''.join(ax) != ''.join(y) or not BUR(''.join(y)):
        continue
    tot += 1
    if ax == y:
        same += 1
    elif len(y) > len(ax):
        lin_more += 1
        if len(ex_l) < 3: ex_l.append((ax, y))
    elif len(ax) > len(y):
        syl_more += 1
        if len(ex_s) < 3: ex_s.append((ax, y))
    else:
        other += 1
print(f"  Burmese-only comparable lines : {tot}")
print(f"    identical segmentation      : {same} ({same/tot*100:.1f}%)")
print(f"    lingux emitted MORE units   : {lin_more}")
print(f"    sylbreak emitted MORE units : {syl_more}")
print(f"    same count, different cuts  : {other}")
def show(label, rows):
    if not rows: return
    print(f"\n  ── {label} ──")
    for ax, by in rows:
        i = 0
        while i < min(len(ax), len(by)) and ax[i] == by[i]: i += 1
        print(f"    sylbreak: {'|'.join(ax[max(0,i-1):i+3])}")
        print(f"    lingux  : {' '.join(by[max(0,i-1):i+3])}")
show("lingux split further", ex_l)
show("sylbreak split further", ex_s)
PY2

echo
echo "════════ 2b. known divergence cases ════════"
scaffold
printf 'ယန့်\nလျှက်\nလျှံ\nဆောင့်\nမြင့်\nနှင့်\n' > "$ROOT/PDF/Python/File/input/input.txt"
rm -f "$ROOT/PDF/Python/File/.output/txt/"*.txt
( cd "$ROOT" && timeout 300 node Private/Syllable/cli.js PDF/Python/File/input/input.txt >/dev/null 2>&1 )
KS=$(ls "$ROOT/PDF/Python/File/.output/txt/"*syllable.txt 2>/dev/null | head -1)
printf '  %-10s %-20s %s\n' word lingux sylbreak
paste -d'|' "$ROOT/PDF/Python/File/input/input.txt" <(head -6 "$KS") \
      <(python3 "$SYL/python/sylbreak.py" -i "$ROOT/PDF/Python/File/input/input.txt") |
  while IFS='|' read -r a b c; do printf '  %-10s %-20s %s\n' "$a" "$b" "$c"; done
echo "  (နှင့်/မြင့်/ဆောင့်: lingux correct, sylbreak splits at the dot-below)"
echo "  (လျှက်: sylbreak correct, lingux splits the ှ out — but လျှံ is fine)"

echo "════════ 3. Zawgyi input (what real Burmese PDFs contain) ════════"
python3 - "$PRASER" "$WORK" <<'PY'
import sys
sys.path.insert(0, sys.argv[1] + '/module')
from rabbit import Rabbit
zg = "ေကာငး့ကငးမီ့လြ္ဵတိုကးပျဲ"
open(sys.argv[2] + '/zg.txt', 'w', encoding='utf-8').write(zg + '\n')
print(f"  raw Zawgyi (as pdf.js returns it): {zg}")
print(f"  PRASER/Rabbit recovers           : {Rabbit.zg2uni(zg)}")
PY
printf '  sylbreak sees it as              : '
python3 "$SYL/python/sylbreak.py" -i "$WORK/zg.txt"
echo "  → sylbreak has no encoding detection; it segments Zawgyi as if Unicode."

echo
echo "════════ 4. adversarial input (20,000-char tail) ════════"
python3 -c "
open('$WORK/adv.txt','w',encoding='utf-8').write('နော'+'း'*20000+'\n'+'က'+'ျ'*5000+'\n'+'မင်္ဂလာပါ။\n')"
s=$(now); timeout 300 python3 "$SYL/python/sylbreak.py" -i "$WORK/adv.txt" -o "$WORK/adv_syl.txt"; e=$(now)
echo "  sylbreak: $(el "$s" "$e") s → $(wc -c < "$WORK/adv_syl.txt") bytes out (passes the junk through)"

cp "$WORK/adv.txt" "$ROOT/PDF/Python/File/input/input.txt"
rm -f "$ROOT/PDF/Python/File/.output/txt/"*.txt
s=$(now); ( cd "$ROOT" && timeout 300 node Private/Syllable/cli.js PDF/Python/File/input/input.txt >/dev/null 2>&1 ); e=$(now)
LADV=$(ls "$ROOT/PDF/Python/File/.output/txt/"*syllable.txt 2>/dev/null | head -1)
echo "  lingux  : $(el "$s" "$e") s → $(wc -c < "$LADV" 2>/dev/null || echo 0) bytes out (absorbs it)"

echo
echo "════════ done ════════"
echo "  Neither tool is 'better' outright: sylbreak is a segmenter, lingux is a"
echo "  pipeline. Compare row by row, not by the headline number."
