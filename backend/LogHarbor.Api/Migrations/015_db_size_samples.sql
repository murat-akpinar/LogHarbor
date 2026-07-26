-- 015: db_size_samples — how fast the database is actually growing (docs/archiving.md)
--
-- MaxDatabaseBytes says when the server starts dropping the oldest day. Nothing said when
-- that would first happen, so the operator sets a ceiling and then waits to be surprised by
-- it. The size is already measured on every hourly maintenance pass — the size cap decides
-- on it — and was thrown away each time; this table only keeps it.
--
-- A measured slope rather than a model built from events-per-day: it already includes the
-- indexes, the FTS shadow tables, hydrated days and whatever an incremental vacuum gave
-- back, none of which an events-per-day estimate can see.
--
-- One row per pass, pruned to a fixed window, so the table stays a few hundred rows.

CREATE TABLE db_size_samples (
  taken_at TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL
);
