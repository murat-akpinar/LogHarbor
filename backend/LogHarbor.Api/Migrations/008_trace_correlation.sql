-- 008: trace/span correlation columns (docs/data-model.md). CLEF @tr/@sp — and,
-- later, OTLP trace_id/span_id — land here so one filter finds a whole request.
-- events_cache gets the same columns or the archive hydrate INSERT would fail.

ALTER TABLE events ADD COLUMN trace_id TEXT;
ALTER TABLE events ADD COLUMN span_id TEXT;
ALTER TABLE events_cache ADD COLUMN trace_id TEXT;
ALTER TABLE events_cache ADD COLUMN span_id TEXT;

-- partial: most events carry no trace, so the index only pays for rows that do
CREATE INDEX ix_events_trace ON events(trace_id) WHERE trace_id IS NOT NULL;
