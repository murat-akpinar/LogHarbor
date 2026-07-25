-- 012: (trace_id, span_id) is a span's identity, so it must be unique.
-- OTLP delivery is at-least-once: every exporter retries on a timeout or 5xx, and a retry the
-- server did process re-inserted the whole batch, drawing each span twice in the waterfall with
-- doubled durations. Logs survive duplication; a trace visibly breaks.
--
-- Collapse any duplicates already stored (keep the first row of each identity), then constrain.
-- ix_spans_trace becomes redundant for lookups this index also serves, but it stays: the
-- waterfall reads by trace_id alone and a leading-column prefix of the unique index would do,
-- so dropping it is a separate, measurable decision.

DELETE FROM spans
WHERE id NOT IN (SELECT MIN(id) FROM spans GROUP BY trace_id, span_id);

CREATE UNIQUE INDEX ux_spans_identity ON spans(trace_id, span_id);
