import logger from '../../../Private/Bridge/logen.js';
import session from 'express-session';
import MySQLStore from 'express-mysql-session';
import { pool } from './db.js';
import {
  sessionBypassEnabled,
  sessionBypassIgnored,
  agentUploadEnabled,
  agentUploadIgnored,
} from '../cookie/devbypass.js';
export function createSessionMiddleware({
  secret = process.env.SESSION_SECRET || 'super-secret-key',
  maxAge = 24 * 60 * 60 * 1000,
  checkExpirationInterval = 15 * 60 * 1000,
} = {}) {
  // DEV_BYPASS_SESSION: keep express-session (real session ids are still
  // minted) but drop the MySQL store — the DB is not reachable in dev.
  // sessionBypassEnabled fails closed, so this never activates in production;
  // sessionBypassIgnored keeps the flag equally inert when it is set anyway.
  if (
    sessionBypassEnabled() ||
    sessionBypassIgnored() ||
    agentUploadEnabled() ||
    agentUploadIgnored()
  ) {
    if (sessionBypassEnabled()) {
      console.log(
        '[session] DEV_BYPASS_SESSION — express-session on MemoryStore (no DB).',
      );
    }
    if (agentUploadEnabled()) {
      console.log(
        '[session] ALLOW_AGENT_UPLOAD — express-session on MemoryStore (no DB).',
      );
    }
    return session({
      name: 'sid',
      secret,
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
