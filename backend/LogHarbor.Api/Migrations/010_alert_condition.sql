-- 010: alert condition: 'at-least' (fire on >= threshold, the existing behavior and
-- default) or 'silence' (dead man's switch: fire when a once-alive signal goes quiet).
-- Appended last so SqliteAlertStore reader ordinals do not shift (docs/api.md ALERTS).

ALTER TABLE alert_rules ADD COLUMN condition TEXT NOT NULL DEFAULT 'at-least';
