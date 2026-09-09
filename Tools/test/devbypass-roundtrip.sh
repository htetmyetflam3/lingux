#!/usr/bin/env bash
# Round-trip test for the /api/submit chain with DEV_BYPASS_SESSION=true.
# Exercises: text submit · PDF upload (server-side PRASER) · DOCX upload
# (server-side PRASER, Zawgyi fixture) · cookie/X-Visitor-Token round trip ·
# engine raw pull · zero-DB assertion.
#
# Usage:  bash Tools/test/devbypass-roundtrip.sh [PORT]
# Requires: the Site server running with DEV_BYPASS_SESSION=true
#           (SKIP_BUILD=true PORT=$PORT DEV_BYPASS_SESSION=true node Site/index.js)
set -u
PORT="${1:-3210}"
BASE="http://127.0.0.1:$PORT"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PDF="$ROOT/Site/Public/PRASER/Python/upload/input/pdf/test.pdf"
DOCX="$ROOT/Site/Public/PRASER/Python/upload/input/docx/zawgyi_fixture.docx"
KEY="$(grep '^FSM_KEY=' "$ROOT/.env" | cut -d= -f2)"

fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; else echo "FAIL  $1 (expected $2, got $3)"; fail=1; fi
}

echo "== 1) text submit =="
code=$(curl -s "$BASE/api/submit" -X POST -H 'Content-Type: application/json' \
  -d '{"text":"မင်္ဂလာပါ ကမ္ဘာ"}' -D /tmp/rt_h1.txt -o /tmp/rt_b1.json -w '%{http_code}')
check "text submit -> 202" 202 "$code"

echo "== 2) PDF upload (server-side PRASER) =="
code=$(curl -s "$BASE/api/submit" -X POST -F "file=@$PDF" \
  -D /tmp/rt_h2.txt -o /tmp/rt_b2.json -w '%{http_code}')
check "pdf submit -> 202" 202 "$code"

echo "== 3) DOCX upload (raw-Zawgyi fixture -> converted) =="
code=$(curl -s "$BASE/api/submit" -X POST -F "file=@$DOCX" \
  -D /tmp/rt_h3.txt -o /tmp/rt_b3.json -w '%{http_code}')
check "docx submit -> 202" 202 "$code"

echo "== 4) bodies are single plain content =="
node - "$fail" <<'EOF'
import fs from 'fs';
let bad = 0;
for (const f of ['/tmp/rt_b1.json', '/tmp/rt_b2.json', '/tmp/rt_b3.json']) {
  const { text } = JSON.parse(fs.readFileSync(f, 'utf8'));
  const html = /<[a-zA-Z/][^>]*>/.test(text);
  const banner = text.startsWith('#');
  const marker = text.includes('--- Page');
  if (!text?.length || html || banner || marker) { console.log(`FAIL  body shape ${f}`); bad = 1; }
  else console.log(`PASS  body shape ${f} (len=${text.length})`);
}
process.exit(bad);
EOF
[ $? -ne 0 ] && fail=1

echo "== 5) token signature round trip =="
tok1=$(grep -i '^x-visitor-token:' /tmp/rt_h1.txt | tr -d '\r' | awk '{print $2}')
cookie=$(grep -i '^set-cookie: userData=' /tmp/rt_h1.txt | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)
code=$(curl -s "$BASE/api/submit" -X POST -H 'Content-Type: application/json' \
  -H "Cookie: $cookie" -d '{"text":"round trip"}' -D /tmp/rt_h4.txt -o /tmp/rt_b4.json -w '%{http_code}')
check "replay -> 202" 202 "$code"
tok2=$(grep -i '^x-visitor-token:' /tmp/rt_h4.txt | tr -d '\r' | awk '{print $2}')
check "X-Visitor-Token stable" "$tok1" "$tok2"

echo "== 6) engine raw pull =="
submit=$(node -e "console.log(JSON.parse(fs.readFileSync('/tmp/rt_b3.json','utf8')).submitId)" 2>/dev/null \
  || python3 -c "import json;print(json.load(open('/tmp/rt_b3.json'))['submitId'])")
code=$(curl -s "$BASE/api/hidden/raw/$submit" -H "X-API-Key: $KEY" -o /tmp/rt_raw.txt -w '%{http_code}')
check "raw pull -> 200" 200 "$code"
code=$(curl -s -o /dev/null "$BASE/api/hidden/raw/$submit" -H "X-API-Key: wrong" -w '%{http_code}')
check "bad key -> 403" 403 "$code"

echo "== 7) Site -> Private engine bridge (file submissions) =="
# Requires the engine api-server running: PORT=9000 node Private/Syllable/api-server.js
node - <<'EOF'
import fs from 'fs';
let bad = 0;
for (const [name, f] of [['PDF', '/tmp/rt_b2.json'], ['DOCX', '/tmp/rt_b3.json']]) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const e = d.engine || {};
  if (!e.connected) { console.log(`FAIL  ${name} engine push (${e.error || 'no engine block'})`); bad = 1; continue; }
  if (e.engineHash !== d.submitId) { console.log(`FAIL  ${name} engineHash != submitId`); bad = 1; }
  else console.log(`PASS  ${name} engine push, hash==submitId (${e.syllableCount} lines)`);
  if (name === 'DOCX') {
    if (e.docxPath && fs.existsSync(e.docxPath)) console.log(`PASS  DOCX result rewritten -> ${e.docxPath}`);
    else { console.log('FAIL  DOCX result not rewritten'); bad = 1; }
  }
}
process.exit(bad);
EOF
[ $? -ne 0 ] && fail=1

echo "== 8) pre-receive validator: misaligned pushes must be REJECTED =="
KEY="$KEY" node - <<'EOF'
import crypto from 'crypto';
const EP = process.env.ENGINE_ENDPOINT || 'http://localhost:9000';
const TEXT = 'မင်္ဂလာပါ ကမ္ဘာ။ နေကောင်းလား';
const sha = crypto.createHash('sha256').update(TEXT, 'utf8').digest('hex');
const bytes = Buffer.byteLength(TEXT, 'utf8');
const submitId = crypto.randomUUID();
const meta = {
  formId: crypto.randomUUID(),
  submitId,
  filename: `${submitId}.pdf`,       // frontend-created shape
  userId: 1,
  sessionId: crypto.randomUUID(),    // session cookie identity
  source: 'file',
  originalName: 'validator-test.pdf',
  textSha256: sha,
  textBytes: bytes,
};
const KEY = process.env.KEY; // FSM_KEY from .env — handshake requires it
async function pre(over = {}) {
  return fetch(`${EP}/metadata`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
    body: JSON.stringify({ ...meta, ...over }) });
}
async function push(over = {}) {
  return fetch(`${EP}/process`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
    body: JSON.stringify({
      text: TEXT, hash: submitId, filename: meta.filename,
      userId: meta.userId, sessionId: meta.sessionId, ...over }) });
}
let bad = 0;
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) bad = 1;
};

await pre();
let r = await push();
check('aligned push accepted', r.status === 200);

r = await push();
check('replay rejected (record burned)', r.status === 403);

r = await push();
check('push without pre-receive rejected', r.status === 403);

await pre();
r = await push({ sessionId: 'evil-session' });
check('tampered sessionId rejected', r.status === 403);

await pre();
r = await push({ userId: 999 });
check('tampered userId rejected', r.status === 403);

await pre();
r = await push({ filename: 'someone-else.txt' });
check('swapped filename rejected', r.status === 403);

await pre();
r = await push({ text: TEXT.slice(0, -1) + 'ာ' });
check('tampered text (sha mismatch) rejected', r.status === 403);

r = await pre({ sessionId: undefined });
check('pre-receive without sessionId refused', r.status === 400);

r = await pre({ filename: 'random-name.pdf' });
check('pre-receive with non-frontend filename refused', r.status === 400);

await pre();
r = await push();
check('honest push after rejects still accepted', r.status === 200);

process.exit(bad);
EOF
[ $? -ne 0 ] && fail=1

echo "== 9) engine handshake gate (key + ip + origin) =="
KEYV="$(grep '^FSM_KEY=' "$ROOT/.env" | cut -d= -f2)"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# /health stays open (liveness, no key)
check "engine /health open (no key)" 200 "$(code http://127.0.0.1:9000/health)"

# no key -> 403
check "engine: no key -> 403" 403 "$(code -X POST http://127.0.0.1:9000/metadata -H 'Content-Type: application/json' -d '{}')"

# wrong key -> 403
check "engine: wrong key -> 403" 403 "$(code -X POST http://127.0.0.1:9000/metadata -H 'Content-Type: application/json' -H 'X-API-Key: wrong-key' -d '{}')"

# right key, evil origin -> 403
check "engine: foreign origin -> 403" 403 "$(code -X POST http://127.0.0.1:9000/metadata -H 'Content-Type: application/json' -H "X-API-Key: $KEYV" -H 'Origin: https://evil.example' -d '{}')"

# right key, allowed origin (localhost:3000) -> GATE PASSES (400 = body validation, not 403)
check "engine: localhost:3000 origin passes gate" 400 "$(code -X POST http://127.0.0.1:9000/metadata -H 'Content-Type: application/json' -H "X-API-Key: $KEYV" -H 'Origin: http://localhost:3000' -d '{}')"

# right key, no origin header (server-to-server) -> key+ip gate it -> 400 (accepted gate, malformed body)
check "engine: no origin (s2s) passes gate -> 400 on empty body" 400 "$(code -X POST http://127.0.0.1:9000/metadata -H 'Content-Type: application/json' -H "X-API-Key: $KEYV" -d '{}')"

# caller-IP gate: second engine instance whose allowlist EXCLUDES loopback
PORT=9005 ENGINE_ALLOWED_IPS=10.0.0.99 node "$ROOT/Private/Syllable/api-server.js" >/tmp/eng9005.log 2>&1 &
EPID=$!
for i in 1 2 3 4 5 6; do curl -s -o /dev/null http://127.0.0.1:9005/health && break; sleep 0.5; done
check "engine: caller ip not allow-listed -> 403" 403 "$(code -X POST http://127.0.0.1:9005/metadata -H 'Content-Type: application/json' -H "X-API-Key: $KEYV" -d '{}')"
kill "$EPID" 2>/dev/null

echo
[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILURES"
exit "$fail"
