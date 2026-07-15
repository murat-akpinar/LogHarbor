-- 004: archive_segments + events_cache + cache FTS + settings (docs/archiving.md, docs/data-model.md)

CREATE TABLE archive_segments (
  day TEXT PRIMARY KEY,               -- 'YYYY-MM-DD'
  file_path TEXT NOT NULL,            -- relative to the archive directory
  event_count INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  uncompressed_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'cold',-- cold | hydrating | hydrated
  hydrated_at TEXT,
  last_accessed_at TEXT
);

-- id is the ORIGINAL events.id (no AUTOINCREMENT here); keyset pagination stays
-- stable across hot and hydrated data because ids never change or collide
CREATE TABLE events_cache (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  message_template TEXT,
  properties TEXT,
  exception TEXT,
  ingested_at TEXT NOT NULL,
  segment_day TEXT NOT NULL REFERENCES archive_segments(day)
);
CREATE INDEX ix_events_cache_timestamp ON events_cache(timestamp);
CREATE INDEX ix_events_cache_segment ON events_cache(segment_day);

CREATE VIRTUAL TABLE events_cache_fts USING fts5(
  message,
  exception,
  content='events_cache',
  content_rowid='id'
);

CREATE TRIGGER events_cache_fts_insert AFTER INSERT ON events_cache BEGIN
  INSERT INTO events_cache_fts(rowid, message, exception)
  VALUES (new.id, new.message, new.exception);
END;

CREATE TRIGGER events_cache_fts_delete AFTER DELETE ON events_cache BEGIN
  INSERT INTO events_cache_fts(events_cache_fts, rowid, message, exception)
  VALUES ('delete', old.id, old.message, old.exception);
END;

-- runtime-changeable settings (archive settings today); value is JSON
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
