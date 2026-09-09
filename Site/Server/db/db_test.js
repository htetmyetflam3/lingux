import logger from '../../../Private/Bridge/logen.js';
import 'dotenv/config';
import { pool } from './db.js';
async function testDB() {
  try {
    const [sessionResult] = await pool.query(
      'INSERT INTO sessions (session_id, expires, data) VALUES (?, ?, ?)',
      [
        'test-session-123',
        Math.floor(Date.now() / 1000) + 3600,
        '{"user":"test"}',
      ],
    );
    console.log('[TEST] Inserted into sessions:', sessionResult.insertId);
    const [userResult] = await pool.query(
      'INSERT INTO users (cookie_hash, visitor_id, cf_header_ip, t) VALUES (?, ?, ?, ?)',
      ['test-cookie-hash', 'visitor-123', '127.0.0.1', 0],
    );
    console.log('[TEST] Inserted into users:', userResult.insertId);
    const [logResult] = await pool.query(
      'INSERT INTO user_logs (user_id, action, details) VALUES (?, ?, ?)',
      [userResult.insertId, 'test_action', JSON.stringify({ test: true })],
    );
    console.log('[TEST] Inserted into user_logs:', logResult.insertId);
    const [sessions] = await pool.query(
      'SELECT * FROM sessions WHERE session_id = ?',
      ['test-session-123'],
    );
    console.log('[TEST] Fetched session:', sessions);
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [
      userResult.insertId,
    ]);
    console.log('[TEST] Fetched user:', users);
    const [logs] = await pool.query(
      'SELECT * FROM user_logs WHERE user_id = ?',
      [userResult.insertId],
    );
    console.log('[TEST] Fetched logs:', logs);
  } catch (err) {
    logger.log('ERROR:', '[TEST] DB error:', err);
  } finally {
    pool.end();
  }
}
testDB();
