-- 005: users table for multi-user auth with roles (docs/api.md AUTH)

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_salt TEXT NOT NULL,        -- base64
  password_hash TEXT NOT NULL,        -- base64, PBKDF2-SHA256 (LogHarbor.Core PasswordHasher)
  role TEXT NOT NULL,                 -- admin | viewer
  created_at TEXT NOT NULL
);
