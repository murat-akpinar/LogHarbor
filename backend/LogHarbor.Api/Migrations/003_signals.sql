-- 003: signals table (docs/data-model.md SIGNAL)

CREATE TABLE signals (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL UNIQUE,
  filter TEXT NOT NULL,
  created_at TEXT NOT NULL
);
