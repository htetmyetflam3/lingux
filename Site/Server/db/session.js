import logger from '../../../Private/Bridge/logen.js';
import session from 'express-session';
import MySQLStore from 'express-mysql-session';
import { pool } from './db.js';
export function createSessionMiddleware({
  secret = process.env.SESSION_SECRET || 'super-secret-key',
  maxAge = 24 * 60 * 60 * 1000,
  checkExpirationInterval = 15 * 60 * 1000,
} = {}) {
  const MySQLSessionStore = MySQLStore(session);
  const store = new MySQLSessionStore(
    {
      tableName: 'sessions',
      checkExpirationInterval,
      expiration: maxAge,
      schema: {
        tableName: 'sessions',
        columnNames: {
          session_id: 'session_id',
          expires: 'expires',
          data: 'data',
        },
      },
    },
    pool,
  );
  store.on('error', (err) => {
    logger.log('ERROR:', '[SessionStore]', err.message);
  });
  return session({
    name: 'sid',
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge,
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
    },
  });
}
