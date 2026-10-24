#!/bin/sh
# Restore MonoSyllabism + its generated syllable tree.
#
# MonoSyllabism comes from this repo's `architecture` branch (87 files).
# File/.tree/ is GENERATED and is NOT committed there -- the built tree is
# tracked in the scraper repo's `release` branch under Engine/.cache-tree/.
# .debug/ is wiped between turns, so this has to be re-run each session.
# Do not try to rebuild the tree locally; it needs `bytenode` to read the
# sealed master (see rebuild-mono-tree.mjs, kept as a record of that).
set -e
cd "$(dirname "$0")/../.."
MONO=.debug/mono

[ -d "$MONO/MonoSyllabism" ] || {
  git fetch --depth=1 origin architecture
  mkdir -p "$MONO"
  git archive FETCH_HEAD | tar -x -C "$MONO"
}

mkdir -p "$MONO/File/.tree"
if [ ! -f "$MONO/File/.tree/ref-syllables.json" ]; then
  rm -rf .debug/scraper
  git clone --depth 1 --branch release --filter=blob:none --no-checkout \
    https://github.com/htetmyetflam3/scraper.git .debug/scraper
  ( cd .debug/scraper
    git sparse-checkout init --cone
    git sparse-checkout set Engine/.cache-tree
    git checkout )
  cp .debug/scraper/Engine/.cache-tree/* "$MONO/File/.tree/"
fi

echo "MonoSyllabism files: $(find "$MONO" -type f | wc -l)"
echo "tree files: $(ls "$MONO/File/.tree" | tr '\n' ' ')"

# The runtime imports the SEALED map/loader.js, which needs `bytenode` to
# read the encrypted payload. map/open-loader.js is the readable shim with
# an identical surface -- point the three consumers at it.
for f in MonoSyllabism/generators/input.js \
         MonoSyllabism/main/phoneme/lexer.js \
         MonoSyllabism/utilities/formatter.js; do
  [ -f "$MONO/$f" ] && sed -i 's|/map/loader\.js|/map/open-loader.js|g' "$MONO/$f"
done

# ...and the shim itself, which is also not in git.
[ -f "$MONO/MonoSyllabism/map/open-loader.js" ] || \
  cp analysis/vector-medial/open-loader.js "$MONO/MonoSyllabism/map/open-loader.js"
# sourceMapper.js imports "./_function.js"; the tree ships "function.js".
[ -f "$MONO/MonoSyllabism/mapbuilder/base/_function.js" ] || \
  printf '// Alias: sourceMapper.js imports "./_function.js", the tree ships "function.js".\nexport * from "./function.js";\n' \
    > "$MONO/MonoSyllabism/mapbuilder/base/_function.js"
# sourceMap.js re-lists six names it already exports as consts -> SyntaxError.
python3 - "$MONO/MonoSyllabism/mapbuilder/base/sourceMap.js" <<'EOF'
import sys
p = sys.argv[1]
s = open(p).read()
old = "export { MMap, NewMap, newClause, IMPOSTER, Priority,BLOCK_PUNCT,ALL_DIGITS, PUNCTUATION,Glue,BURMESE_DIGITS,ENGLISH_DIGITS};"
new = "export { MMap, NewMap, newClause, IMPOSTER, Priority };"
if old in s:
    open(p, "w").write(s.replace(old, new))
EOF
# ...and the tables live under master.mapData, not at the root.
python3 - "$MONO/MonoSyllabism/mapbuilder/base/sourceMap.js" <<'EOF'
import sys
p = sys.argv[1]
s = open(p).read()
old = 'import mapData from "../../../knowledge/isTreasure/master.json" with { type: "json" };'
new = ('import master from "../../../knowledge/isTreasure/master.json" with { type: "json" };\n'
       '// The tables sit under master.mapData; this module expects them at the root.\n'
       'const mapData = master.mapData ?? master;')
if old in s:
    open(p, "w").write(s.replace(old, new))
EOF

# (6) Bridge/path.js: TREE_DIR / OUTPUT_DIR / INPUT_DIR ship with a LEADING
#     SLASH ("/File/..."), which makes them absolute and ignores the mono root.
#     The engine is designed to run from a container whose filesystem root holds
#     File/. Strip the leading slash so resolvePath() anchors them at monoRoot.
python3 - "$MONO/Bridge/path.js" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s2 = re.sub(r'^(const (?:TREE_DIR|OUTPUT_DIR|INPUT_DIR)\s*=\s*)"/', r'\1"', s, flags=re.M)
open(p, 'w', encoding='utf-8').write(s2)
PY
