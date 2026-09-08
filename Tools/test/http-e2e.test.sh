#!/usr/bin/env bash
# FILE: Tools/test/http-e2e.test.sh
#
# End-to-end HTTP checks for the Site upload pipeline.
#
# Covers upload validation, the async PDF route, the failure path, the
# synchronous paths that must NOT change, and the frontend's PDF removal.
#
# REQUIRES a running server with the dev bypasses on:
#   cd <repo> && SKIP_BUILD=true node Site/index.js
#
# The bypasses matter: this sandbox/dev box cannot reach the production MySQL
# (srv1415.hstgr.io), so without DEV_BYPASS_QUOTA every request dies at the
# first DB call. See docs/PROJECTSTRUCTURE.md → "Testing realities".
#
# Usage:  bash Tools/test/http-e2e.test.sh [base-url]

set -uo pipefail
BASE="${1:-http://127.0.0.1:3000}"
S="$BASE/api"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PDF="$ROOT/Site/Public/PRASER/Python/upload/input/pdf/test.pdf"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
chk() {
  if [ "$2" = "$3" ]; then
    printf '  PASS  %-32s (%s)\n' "$1" "$3"; pass=$((pass+1))
  else
    printf '  FAIL  %-32s expected %s, got %s\n' "$1" "$3" "$2"; fail=$((fail+1))
  fi
}

if ! curl -s -o /dev/null --max-time 3 "$S/quota"; then
  echo "Server not reachable at $BASE — start it first:"
  echo "  SKIP_BUILD=true node Site/index.js"
  exit 2
fi
[ -f "$PDF" ] || { echo "Missing fixture: $PDF"; exit 2; }

echo "──── A. upload validation (multer limits + magic bytes) ────"
head -c 11000000 /dev/zero | tr '\0' 'a' > "$TMP/big.txt"
chk "oversized file"        "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$S/submit" -F "file=@$TMP/big.txt")" 413
printf 'MZ' > "$TMP/e.exe"
chk "unsupported extension" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$S/submit" -F "file=@$TMP/e.exe")" 415
cp "$PDF" "$TMP/fake.docx"
chk "PDF bytes named .docx" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$S/submit" -F "file=@$TMP/fake.docx")" 415
printf 'not a pdf' > "$TMP/fake.pdf"
chk "text bytes named .pdf" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$S/submit" -F "file=@$TMP/fake.pdf")" 415
: > "$TMP/empty.txt"
chk "empty file"            "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$S/submit" -F "file=@$TMP/empty.txt")" 415

echo "──── B. PDF route (fast return + background extraction) ────"
T=$(curl -s -X POST "$S/submit" -F "file=@$PDF" -o "$TMP/p.json" -w '%{time_total}')
chk "submit accepted"       "$(python3 -c "import json;print(json.load(open('$TMP/p.json'))['status'])")" extracting
chk "returns under 0.5s"    "$(python3 -c "print('yes' if $T < 0.5 else 'no')")" yes
echo "        (actual: ${T}s — the extraction itself takes ~2s for 764 pages)"
F=$(python3 -c "import json;print(json.load(open('$TMP/p.json'))['formId'])")
C=""
for _ in $(seq 1 30); do
  C=$(curl -s -o "$TMP/r.json" -w '%{http_code}' -X POST "$S/result" \
        -H 'Content-Type: application/json' -d "{\"formId\":\"$F\"}")
  [ "$C" = "200" ] && break; sleep 0.5
done
chk "poll reaches 200"      "$C" 200
chk "text extracted"        "$(python3 -c "import json;d=json.load(open('$TMP/r.json'));print('yes' if len(d.get('text') or '')>300000 else 'no')")" yes
chk "output is Unicode"     "$(python3 -c "
import json
t=json.load(open('$TMP/r.json'))['text']
print('yes' if sum(t.count(chr(c)) for c in range(0x1060,0x1071))==0 else 'no')")" yes
chk "poll carries quota"    "$(python3 -c "import json;print('yes' if json.load(open('$TMP/r.json')).get('quota') else 'no')")" yes

echo "──── C. failure path ────"
printf '%%PDF-1.4\ngarbage\n' > "$TMP/corrupt.pdf"
curl -s -X POST "$S/submit" -F "file=@$TMP/corrupt.pdf" -o "$TMP/cf.json" > /dev/null
CF=$(python3 -c "import json;print(json.load(open('$TMP/cf.json'))['formId'])")
sleep 2
chk "corrupt PDF → 422"     "$(curl -s -o "$TMP/cr.json" -w '%{http_code}' -X POST "$S/result" -H 'Content-Type: application/json' -d "{\"formId\":\"$CF\"}")" 422
chk "422 explains why"      "$(python3 -c "import json;print('yes' if json.load(open('$TMP/cr.json')).get('error') else 'no')")" yes

echo "──── D. paths that must NOT have changed ────"
printf 'မင်္ဂလာပါ\n' > "$TMP/s.txt"
chk ".txt + client text"    "$(curl -s -X POST "$S/submit" -F "file=@$TMP/s.txt" -F 'text=client parsed' -o "$TMP/d1.json" -w '%{http_code}')" 202
chk "  echoes client text"  "$(python3 -c "import json;print(json.load(open('$TMP/d1.json'))['text'])")" "client parsed"
chk "  carries quota"       "$(python3 -c "import json;print('yes' if json.load(open('$TMP/d1.json')).get('quota') else 'no')")" yes
chk "JSON text submit"      "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$S/submit" -H 'Content-Type: application/json' -d '{"text":"hello"}')" 202
chk "GET /api/quota"        "$(curl -s -o /dev/null -w '%{http_code}' "$S/quota")" 200
python3 - "$TMP" <<'PY'
import sys, zipfile
tmp = sys.argv[1]
d = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hello docx</w:t></w:r></w:p></w:body></w:document>'
ct = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
r = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
with zipfile.ZipFile(f'{tmp}/real.docx', 'w') as z:
    z.writestr('[Content_Types].xml', ct); z.writestr('_rels/.rels', r); z.writestr('word/document.xml', d)
PY
chk "docx accepted"         "$(curl -s -X POST "$S/submit" -F "file=@$TMP/real.docx" -o "$TMP/d3.json" -w '%{http_code}')" 202
DF=$(python3 -c "import json;print(json.load(open('$TMP/d3.json'))['formId'])")
sleep 1.5
chk "  mammoth parsed it"   "$(curl -s -X POST "$S/result" -H 'Content-Type: application/json' -d "{\"formId\":\"$DF\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('text','').strip())")" "hello docx"

echo "──── E. frontend must not parse PDF ────"
chk "extractPdf removed"    "$(grep -c extractPdf "$ROOT/Site/Public/STATIC/Build/js/main.js")" 0
chk "pdf.js CDN removed"    "$(cat "$ROOT/Site/Public/STATIC/Build/js/main.js" "$ROOT/Site/Public/STATIC/Build/index.html" | grep -c 'pdf.min.js')" 0

echo
echo "════ $pass passed, $fail failed ════"
[ "$fail" -eq 0 ] || exit 1
