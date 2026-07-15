-- 002: api_keys table (docs/data-model.md API KEY)

CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);
