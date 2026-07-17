-- 009: per-rule webhook payload format: generic (raw JSON), slack ({"text"}), discord ({"content"})
-- (docs/api.md ALERTS)

ALTER TABLE alert_rules ADD COLUMN payload_format TEXT NOT NULL DEFAULT 'generic';
