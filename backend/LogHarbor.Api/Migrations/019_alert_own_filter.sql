-- 019: an alert rule can carry its own filter instead of pointing at a signal.
--
-- Every rule needed a saved signal first, so "tell me when checkout starts 5xx-ing" meant going
-- to Signals, saving a filter there, and coming back — and on an install with no signals at all
-- no alert could be created. A signal is a filter you want to toggle on while reading events;
-- an alert's condition usually is not one, and forcing it into that list fills a reading tool
-- with rules nobody reads.
--
-- signal_id has to become nullable, which SQLite only does by rebuilding the table. The CHECK
-- puts the invariant where it cannot be forgotten: a rule has a condition, from one side or the
-- other. Column order matches the original so the store's explicit column list is unaffected.

CREATE TABLE alert_rules_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  signal_id INTEGER REFERENCES signals(id),
  filter TEXT,
  threshold_count INTEGER NOT NULL,
  window_minutes INTEGER NOT NULL,
  webhook_url TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_triggered_at TEXT,
  last_error TEXT,
  payload_format TEXT NOT NULL DEFAULT 'generic',
  condition TEXT NOT NULL DEFAULT 'at-least',
  acknowledged_until TEXT,
  acknowledged_by TEXT,
  CHECK (signal_id IS NOT NULL OR filter IS NOT NULL)
);

INSERT INTO alert_rules_new (
  id, title, signal_id, filter, threshold_count, window_minutes, webhook_url, is_enabled,
  created_at, last_triggered_at, last_error, payload_format, condition,
  acknowledged_until, acknowledged_by)
SELECT
  id, title, signal_id, NULL, threshold_count, window_minutes, webhook_url, is_enabled,
  created_at, last_triggered_at, last_error, payload_format, condition,
  acknowledged_until, acknowledged_by
FROM alert_rules;

DROP TABLE alert_rules;

ALTER TABLE alert_rules_new RENAME TO alert_rules;
