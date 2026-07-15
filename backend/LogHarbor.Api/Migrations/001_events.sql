-- 001: events table, indexes, FTS5 index + sync triggers (docs/data-model.md)

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  message_template TEXT,
  properties TEXT,
  exception TEXT,
  ingested_at TEXT NOT NULL
);
-- AUTOINCREMENT is deliberate: it forbids rowid reuse, so new events can never
-- collide with original ids preserved in archive segments (docs/archiving.md)

CREATE INDEX ix_events_timestamp ON events(timestamp);
CREATE INDEX ix_events_level ON events(level, timestamp);

CREATE VIRTUAL TABLE events_fts USING fts5(
  message,
  exception,
  content='events',
  content_rowid='id'
);

CREATE TRIGGER events_fts_insert AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, message, exception)
  VALUES (new.id, new.message, new.exception);
END;

CREATE TRIGGER events_fts_delete AFTER DELETE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, message, exception)
  VALUES ('delete', old.id, old.message, old.exception);
END;
