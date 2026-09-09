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

echo "== 8) hidden-delivered metadata: praser side must ALIGN or be REJECTED =="
RAW_TXT_DIR="$ROOT/Site/Public/PRASER/Python/.output/txt"
KEY="$KEY" RAW_TXT_DIR="$RAW_TXT_DIR" node - <<'EOF'
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
const EP = 'http://127.0.0.1:9000';
const KEY = process.env.KEY;          // FSM_KEY — only hidden's endpoint carries it
const RAW = process.env.RAW_TXT_DIR;  // rawSaver's deterministic txt dir
const checks = [];
function check(name, ok, extra = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' (' + extra + ')' : ''}`);
}
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const sid = () => crypto.randomUUID();
const H = 'x'.repeat(32);

function meta(id) {
  return { submitId: id, filename: `${id}.pdf`, userId: 'u-1', sessionId: H, formId: 'f-1', source: 'file' };
}
const TEXT = 'မင်္ဂလာပါ\nကောင်းသည်\n';
const SHA = sha(TEXT);
const BYTES = Buffer.byteLength(TEXT, 'utf8');

// hidden's half: KEYED /fsm delivery (the ONLY record creator)
function fsm(id, over = {}, withSha = true) {
  return fetch(`${EP}/fsm`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
    body: JSON.stringify({
      ...meta(id), fileName: `${id}.pdf`, status: 'pending',
      ...(withSha ? { textSha256: SHA, textBytes: BYTES } : {}), ...over }) });
}
// praser's half: BLIND /metadata declare (NO key header — metadata is the key)
function declare(id, over = {}) {
  return fetch(`${EP}/metadata`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...meta(id), textSha256: SHA, textBytes: BYTES, ...over }) });
}
// praser's half: BLIND /process push (body text or pull signal)
function push(id, over = {}) {
  return fetch(`${EP}/process`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: TEXT, hash: id, filename: `${id}.pdf`,
      userId: 'u-1', sessionId: H, ...over }) });
}

// 1) aligned dance accepted (fsm -> declare -> push)
let id = sid();
let r = await fsm(id); let j = await r.json();
check('fsm delivery (keyed) stored', r.status === 200 && j.stored === 1, JSON.stringify(j.pending));
r = await declare(id);
check('blind declare aligned -> verified', r.status === 200 && (await r.json()).verified === true);
r = await push(id);
check('aligned push accepted', r.status === 200, String(r.status));
await r.json().catch(() => {});

// 2) replay dies (record burned)
r = await push(id, { text: TEXT });
check('replay rejected (record burned)', r.status === 403, String(r.status));

// 3) push with NO hidden delivery at all
let id2 = sid();
r = await push(id2);
check('push without hidden delivery rejected', r.status === 403, String(r.status));

// 4) declare tampered sessionId -> 403 + record burned
let id3 = sid();
await fsm(id3);
r = await declare(id3, { sessionId: 't'.repeat(32) });
check('declare tampered sessionId rejected', r.status === 403, String(r.status));
r = await push(id3);
check('honest push after poisoned declare rejected', r.status === 403, String(r.status));

// 5) declare tampered userId
let id4 = sid();
await fsm(id4);
r = await declare(id4, { userId: 'intruder' });
check('declare tampered userId rejected', r.status === 403, String(r.status));

// 6) declare swapped filename
let id5 = sid();
await fsm(id5);
r = await declare(id5, { filename: 'not-the-frontend-name.pdf' });
check('declare swapped filename rejected', r.status === 403, String(r.status));

// 7) push with tampered text (sha mismatch vs delivered)
let id6 = sid();
await fsm(id6);
await declare(id6);
r = await push(id6, { text: 'တမ်းစာ\n' });
check('push tampered text (sha mismatch) rejected', r.status === 403, String(r.status));

// 8) fsm missing sessionId refused
r = await fsm(sid(), { sessionId: undefined });
check('fsm delivery without sessionId refused', r.status === 400, String(r.status));

// 9) fsm with non-frontend filename refused
r = await fsm(sid(), { filename: 'original-name.pdf', fileName: 'original-name.pdf' });
check('fsm with non-frontend filename refused', r.status === 400, String(r.status));

// 10) PULL MODE: delivery with fileUrl only -> engine pulls the raw txt itself
let id7 = sid();
fs.mkdirSync(RAW, { recursive: true });
fs.writeFileSync(path.join(RAW, `${id7}.txt`), TEXT);
const fileUrl = `http://127.0.0.1:3210/api/hidden/raw/${id7}`;
r = await fsm(id7, { fileUrl }, false); // no sha — engine must pull + compute
j = await r.json();
check('fsm with fileUrl only: engine pulled + stored', r.status === 200 && j.stored === 1, JSON.stringify(j));
r = await declare(id7);
check('declare aligned after engine pull', r.status === 200, String(r.status));
r = await fetch(`${EP}/process`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ hash: id7, filename: `${id7}.pdf`, userId: 'u-1', sessionId: H }) }); // NO text — pull signal
check('pull-mode push accepted (engine pulled raw txt)', r.status === 200, String(r.status));
await r.json().catch(() => {});

// 11) honest dance after all the rejects still accepted
let id8 = sid();
await fsm(id8);
await declare(id8);
r = await push(id8);
check('honest push after rejects still accepted', r.status === 200, String(r.status));

process.exit(checks.every(Boolean) ? 0 : 1);
EOF

echo "== 9) engine handshake gate: the KEY guards hidden -> engine (/fsm) =="
KEYV="$(grep '^FSM_KEY=' "$ROOT/.env" | cut -d= -f2)"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# /health stays open (liveness, no key)
check "engine /health open (no key)" 200 "$(code http://127.0.0.1:9000/health)"

# /fsm: no key -> 403
check "engine /fsm: no key -> 403" 403 "$(code -X POST http://127.0.0.1:9000/fsm -H 'Content-Type: application/json' -d '{}')"

# /fsm: wrong key -> 403
check "engine /fsm: wrong key -> 403" 403 "$(code -X POST http://127.0.0.1:9000/fsm -H 'Content-Type: application/json' -H 'X-API-Key: wrong-key' -d '{}')"

# /fsm: right key, evil origin -> 403
check "engine /fsm: foreign origin -> 403" 403 "$(code -X POST http://127.0.0.1:9000/fsm -H 'Content-Type: application/json' -H "X-API-Key: $KEYV" -H 'Origin: https://evil.example' -d '{}')"

# /fsm: right key, allowed origin (localhost:3000) -> GATE PASSES (400 = body validation, not 403)
check "engine /fsm: localhost:3000 origin passes gate" 400 "$(code -X POST http://127.0.0.1:9000/fsm -H 'Content-Type: application/json' -H "X-API-Key: $KEYV" -H 'Origin: http://localhost:3000' -d '{}')"

# /fsm: right key, no origin header (server-to-server) -> key+ip gate it (400 = body validation)
check "engine /fsm: no origin (s2s) passes gate" 400 "$(code -X POST http://127.0.0.1:9000/fsm -H 'Content-Type: application/json' -H "X-API-Key: $KEYV" -d '{}')"

# /metadata is BLIND by design: no key header — but unknown ids still 403
check "engine /metadata: blind (no key), unknown id -> 403" 403 "$(code -X POST http://127.0.0.1:9000/metadata -H 'Content-Type: application/json' -d "{\"submitId\":\"$(node -e "console.log(crypto.randomUUID())")\",\"filename\":\"x.pdf\",\"userId\":\"u\",\"sessionId\":\"$(printf 'a%.0s' {1..32})\",\"formId\":\"f\",\"textSha256\":\"h\",\"textBytes\":1}")"

# /process unkeyed, no delivered record -> 403
check "engine /process: unkeyed, no record -> 403" 403 "$(code -X POST http://127.0.0.1:9000/process -H 'Content-Type: application/json' -d "{\"text\":\"x\",\"hash\":\"$(node -e "console.log(crypto.randomUUID())")\"}")"

# caller-IP gate: second engine instance whose allowlist EXCLUDES loopback
PORT=9005 ENGINE_ALLOWED_IPS=10.0.0.99 node "$ROOT/Private/Syllable/api-server.js" >/tmp/eng9005.log 2>&1 &
EPID=$!
for i in 1 2 3 4 5 6; do curl -s -o /dev/null http://127.0.0.1:9005/health && break; sleep 0.5; done
check "engine /fsm: caller ip not allow-listed -> 403" 403 "$(code -X POST http://127.0.0.1:9005/fsm -H 'Content-Type: application/json' -H "X-API-Key: $KEYV" -d '{}')"
kill "$EPID" 2>/dev/null

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILURES"
exit "$fail"
