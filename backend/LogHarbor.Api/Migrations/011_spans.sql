-- 011: spans table for OTLP trace ingestion (docs/data-model.md). Trace-scoped reads only,
-- so no FTS; ix_spans_trace serves the waterfall and ix_spans_start serves retention.
-- Spans are never archived; retention deletes by start_timestamp age.

CREATE TABLE spans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  service TEXT,
  start_timestamp TEXT NOT NULL,
  duration_ms REAL NOT NULL,
  status_code TEXT NOT NULL,
  status_message TEXT,
  attributes TEXT,
  ingested_at TEXT NOT NULL
);

CREATE INDEX ix_spans_trace ON spans(trace_id);
CREATE INDEX ix_spans_start ON spans(start_timestamp);
