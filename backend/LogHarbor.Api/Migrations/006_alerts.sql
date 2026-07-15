-- 006: alert rules: signal + threshold in a time window -> webhook (docs/api.md ALERTS)

CREATE TABLE alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  signal_id INTEGER NOT NULL REFERENCES signals(id),
  threshold_count INTEGER NOT NULL,
  window_minutes INTEGER NOT NULL,
  webhook_url TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_triggered_at TEXT,
  last_error TEXT
);
