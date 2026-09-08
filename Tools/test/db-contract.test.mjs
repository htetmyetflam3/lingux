// FILE: Tools/test/db-contract.test.mjs
//
// Database-layer tests that need NO database.
//
// The production MySQL (srv1415.hstgr.io) is unreachable from dev boxes and CI
// sandboxes — it whitelists IPs — so every DB-touching path here is exercised
// against a fake pool that implements the mysql2/promise surface we actually
// use. This is not a workaround: it is the only way to assert on things a live
// DB would hide, like "getQuota performed ZERO writes" or "the transaction
// rolled back".
//
// Run:  node Tools/test/db-contract.test.mjs

import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createRequest, DAILY_QUOTA } = await import(
  path.join(ROOT, 'Site/Server/db/request.js')
);
const { attachSqlLogging } = await import(path.join(ROOT, 'Site/Server/db/sqlLog.js'));

let pass = 0;
let fail = 0;
const chk = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(38)} ${ok ? got : `expected ${want}, got ${got}`}`,
  );
  ok ? pass++ : fail++;
};

// mysql2 hands back DATE columns as JS Date objects, not strings — the
// fixtures must match the real driver or the test proves nothing.
const today = () => new Date();

/** Pool that records every statement and answers a fixed user row. */
function fakePool(userRow) {
  const writes = [];
  return {
    writes,
    query: async (sql, values) => {
      if (/^\s*(UPDATE|INSERT|DELETE)/i.test(sql)) writes.push(sql.trim().split('\n')[0]);
      if (/FROM\s+users/i.test(sql)) return [userRow ? [userRow] : []];
      return [[]];
    },
  };
}

console.log(`\n════ getQuota() is read-only (DAILY_QUOTA=${DAILY_QUOTA}) ════`);
process.env.DEV_BYPASS_QUOTA = 'false';

const cases = [
  ['fresh user', { id: 1, daily_quota_used: 0, daily_quota_reset: today() }, true, 0, 3],
  ['one used today', { id: 1, daily_quota_used: 1, daily_quota_reset: today() }, true, 1, 2],
  ['limit reached', { id: 1, daily_quota_used: 3, daily_quota_reset: today() }, false, 3, 0],
  ['stale reset date', { id: 1, daily_quota_used: 3, daily_quota_reset: new Date('2020-01-01') }, true, 0, 3],
  ['never reset', { id: 1, daily_quota_used: 2, daily_quota_reset: null }, true, 0, 3],
];

for (const [label, row, allowed, used, remaining] of cases) {
  const pool = fakePool(row);
  const q = await createRequest({ pool }).getQuota({ userId: 1 });
  chk(`${label} → allowed`, q.allowed, allowed);
  chk(`${label} → used/remaining`, `${q.used}/${q.remaining}`, `${used}/${remaining}`);
  chk(`${label} → no writes`, pool.writes.length, 0);
}

const unknown = fakePool(null);
chk(
  'unknown user rejected',
  (await createRequest({ pool: unknown }).getQuota({ userId: 99 })).allowed,
  false,
);
chk('unknown user → no writes', unknown.writes.length, 0);

console.log('\n════ commitSubmission() is one transaction ════');

/** Pool whose connection can be told to throw on the Nth statement. */
function txnPool(failOn = null) {
  const trace = [];
  let n = 0;
  const conn = {
    query: async (sql) => {
      n++;
      const tag = /submissions/i.test(sql)
        ? 'UPDATE submissions'
        : /daily_quota_used/i.test(sql)
          ? 'UPDATE users(+1)'
          : 'QUERY';
      if (failOn === n) {
        trace.push(`${tag} THREW`);
        throw new Error('simulated write failure');
      }
      trace.push(tag);
      return [{ affectedRows: 1 }];
    },
    beginTransaction: async () => trace.push('BEGIN'),
    commit: async () => trace.push('COMMIT'),
    rollback: async () => trace.push('ROLLBACK'),
    release: () => trace.push('release'),
  };
  return { trace, query: async () => [[]], getConnection: async () => conn };
}

const args = {
  userId: 1,
  visitorHash: 'h',
  formId: 'f',
  submitId: 's',
  filename: 's.txt',
  bridgePath: '/tmp/s.txt',
  originalName: 'a.pdf',
};

const happy = txnPool();
const happyResult = await createRequest({ pool: happy }).commitSubmission(args);
chk('happy path charged', happyResult.charged, true);
chk('happy path trace', happy.trace.join(' → '),
  'BEGIN → UPDATE submissions → UPDATE users(+1) → COMMIT → release');

const failSubmission = txnPool(1);
try {
  await createRequest({ pool: failSubmission }).commitSubmission(args);
} catch { /* expected */ }
chk('submissions write fails', failSubmission.trace.join(' → '),
  'BEGIN → UPDATE submissions THREW → ROLLBACK → release');

const failQuota = txnPool(2);
try {
  await createRequest({ pool: failQuota }).commitSubmission(args);
} catch { /* expected */ }
chk('quota write fails', failQuota.trace.join(' → '),
  'BEGIN → UPDATE submissions → UPDATE users(+1) THREW → ROLLBACK → release');

console.log('\n════ SQL logging covers BOTH doors ════');

const lines = [];
const conn = {
  query: async () => [[]],
  beginTransaction: async () => {},
  commit: async () => {},
  rollback: async () => {},
  release: () => {},
};
const logged = { query: async () => [[]], getConnection: async () => conn };
attachSqlLogging(logged, (l) => lines.push(l.replace(/\[[^\]]+\]\s*/, '').trim()));

await logged.query('SELECT 1');
const c1 = await logged.getConnection();
await c1.beginTransaction();
await c1.query('UPDATE users SET x = 1');
await c1.commit();
const c2 = await logged.getConnection(); // same object, must not double-wrap
await c2.query('SELECT 2');

chk('pool.query logged', lines.some((l) => l.includes('SQL: SELECT 1')), true);
chk('BEGIN logged', lines.some((l) => l.includes('BEGINTRANSACTION')), true);
chk('conn.query logged', lines.some((l) => l.includes('UPDATE users')), true);
chk('COMMIT logged', lines.some((l) => l.includes('COMMIT')), true);
chk('no double-wrap', lines.filter((l) => l.includes('SELECT 2')).length, 1);

console.log(`\n════ ${pass} passed, ${fail} failed ════`);
process.exit(fail === 0 ? 0 : 1);
