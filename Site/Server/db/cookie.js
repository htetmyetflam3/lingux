import { pool } from './db.js';
/**
 * Upsert a user row keyed by cookie_hash.
 * Also stores fingerprint, geo, localStorage token, and last-seen timestamps.
 */
export async function createOrUpdateCookie(cookieData) {
  const hash = cookieData.userId;
  const visitorId = cookieData.userId;
  const cfHeader = cookieData.cfHeader || '192.168.100.1';
  const cfCountry = cookieData.cfCountry || 'MM';
  const userAgent = cookieData.userAgent || 'unknown';
  const deviceFingerprint = cookieData.deviceFingerprint || '';
  const localStorageToken = cookieData.localStorageToken || '';
  const [rows] = await pool.query(
    'SELECT id FROM users WHERE cookie_hash = ?',
    [hash],
  );
  let userId;
  if (rows.length === 0) {
    const [result] = await pool.query(
      `INSERT INTO users
       (cookie_hash, visitor_id, cf_header_ip, cf_country, user_agent,
        device_fingerprint, local_storage_token, t, daily_quota_used,
        daily_quota_reset, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())`,
      [
        hash,
        visitorId,
        cfHeader,
        cfCountry,
        userAgent,
        deviceFingerprint,
        localStorageToken,
        0,
        0,
      ],
    );
    userId = result.insertId;
  } else {
    userId = rows[0].id;
    await pool.query(
      `UPDATE users
       SET cf_header_ip        = ?,
           cf_country            = ?,
           user_agent            = ?,
           device_fingerprint    = ?,
           local_storage_token   = ?,
           updated_at            = NOW()
       WHERE id = ?`,
      [
        cfHeader,
        cfCountry,
        userAgent,
        deviceFingerprint,
        localStorageToken,
        userId,
      ],
    );
  }
  await pool.query(
    `INSERT INTO user_logs
     (user_id, action, details, timestamp)
     VALUES (?, ?, ?, NOW())`,
    [
      userId,
      'cookie_updated',
      JSON.stringify({
        hash,
        ip: cfHeader,
        country: cfCountry,
        fingerprint: deviceFingerprint,
      }),
    ],
  );
  return userId;
}
