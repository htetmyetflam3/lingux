// FILE: Server/db/sqlLog.js
//
// Mirrors every statement the app sends to MySQL into the SQL log.
//
// There are two doors into the database and they need separate wrapping:
//
//   pool.query(...)            — the common path
//   pool.getConnection() then
//     conn.query(...)          — the transaction path
//
// commitSubmission() uses the second one, because the submission row and the
// quota charge have to be one atomic unit. Wrapping only pool.query would mean
// the single most consequential write in the system is the one write that
// never appears in the log.

/**
 * @param {object} pool          mysql2/promise pool (mutated in place)
 * @param {(line: string) => void} write  where log lines go
 * @returns {object} the same pool
 */
export function attachSqlLogging(pool, write) {
  const log = (tag, sql, values) => {
    const ts = new Date().toISOString();
    const sqlStr =
      typeof sql === 'string' ? sql : sql?.sql || '[prepared]';
    write(`[${ts}] SQL${tag}: ${sqlStr}\n`);
    if (values !== undefined) {
      write(`[${ts}] Values${tag}: ${JSON.stringify(values)}\n`);
    }
  };

  const originalQuery = pool.query.bind(pool);
  pool.query = (sql, values, ...rest) => {
    log('', sql, values);
    return originalQuery(sql, values, ...rest);
  };

  // Each transaction gets a tag, so two concurrent submissions do not read as
  // one interleaved mess in the log.
  let txnSeq = 0;
  const originalGetConnection = pool.getConnection.bind(pool);
  pool.getConnection = async (...args) => {
    const conn = await originalGetConnection(...args);

    // Pooled connections are handed out repeatedly; wrapping on every
    // checkout would stack a new layer each time and log N copies.
    if (conn.__sqlLogged) return conn;

    const tag = ` [txn#${++txnSeq}]`;
    const connQuery = conn.query.bind(conn);
    conn.query = (sql, values, ...rest) => {
      log(tag, sql, values);
      return connQuery(sql, values, ...rest);
    };

    for (const step of ['beginTransaction', 'commit', 'rollback']) {
      if (typeof conn[step] !== 'function') continue;
      const originalStep = conn[step].bind(conn);
      conn[step] = (...stepArgs) => {
        log(tag, step.toUpperCase());
        return originalStep(...stepArgs);
      };
    }

    conn.__sqlLogged = true;
    return conn;
  };

  return pool;
}
