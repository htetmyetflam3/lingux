-- FILE: Server/db/schema.sql
-- Database schema for the site server (MySQL 5.7+ / 8.x, Hostinger-compatible).
--
-- Nothing in the code creates these tables (db_test.js only INSERTs into them
-- and assumes they exist; the sessions table is the one exception — the
-- session store creates it automatically on first run).
--
-- Import once on a fresh database, e.g. via phpMyAdmin (Import tab) or:
--   mysql -h srv1415.hstgr.io -u u564950535_Lingux -p u564950535_Lingux < Server/db/schema.sql
--
-- utf8mb4 everywhere: user agents, file names and paths can contain Myanmar text.

CREATE TABLE IF NOT EXISTS users (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cookie_hash          VARCHAR(64)  NOT NULL,
  visitor_id           VARCHAR(64)  DEFAULT NULL,
  cf_header_ip         VARCHAR(64)  DEFAULT NULL,
  cf_country           VARCHAR(8)   DEFAULT NULL,
  user_agent           VARCHAR(512) DEFAULT NULL,
  device_fingerprint   VARCHAR(64)  DEFAULT NULL,
  local_storage_token  VARCHAR(64)  DEFAULT NULL,
  t                    INT          NOT NULL DEFAULT 0,
  daily_quota_used     INT          NOT NULL DEFAULT 0,
  daily_quota_reset    DATETIME     DEFAULT NULL,
  created_at           DATETIME     NOT NULL DEFAULT NOW(),
  updated_at           DATETIME     NOT NULL DEFAULT NOW(),
  UNIQUE KEY uq_users_cookie_hash (cookie_hash),
  KEY idx_users_fingerprint (device_fingerprint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS submissions (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  submission_id   VARCHAR(36)  NOT NULL,           -- formId (UUID from createUploadSession)
  user_id         INT UNSIGNED NOT NULL,
  session_id      VARCHAR(64)  DEFAULT NULL,       -- visitor hash
  source          VARCHAR(16)  DEFAULT NULL,       -- 'file' | 'text' | 'existing'
  status          VARCHAR(24)  DEFAULT 'pending',  -- 'pending' | 'processed'
  file_name       VARCHAR(512) DEFAULT NULL,
  submit_id       VARCHAR(64)  DEFAULT NULL,       -- rawSaver submitId
  bridge_path     VARCHAR(768) DEFAULT NULL,       -- path to the raw text file
  created_at      DATETIME     NOT NULL DEFAULT NOW(),
  updated_at      DATETIME     NOT NULL DEFAULT NOW(),
  UNIQUE KEY uq_submissions_submission_id (submission_id),
  KEY idx_submissions_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_logs (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  action     VARCHAR(64)  DEFAULT NULL,
  details    TEXT         DEFAULT NULL,
  timestamp  DATETIME     NOT NULL DEFAULT NOW(),
  KEY idx_user_logs_user (user_id, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- sessions: created automatically by express-mysql-session
-- (session_id, expires, data) — no manual setup needed.
