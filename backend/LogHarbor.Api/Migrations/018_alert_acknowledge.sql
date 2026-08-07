-- 018: acknowledging an alarm. A firing rule re-fires every window for as long as the
-- condition holds, and there was nothing an operator could do about it but disable the rule
-- and remember to switch it back on. acknowledged_until suppresses the firing and expires by
-- itself; acknowledged_by records who took it, because a silence nobody owns is worse than
-- an alarm nobody silenced (docs/api.md ALERTS).
-- Appended last so SqliteAlertStore reader ordinals do not shift.

ALTER TABLE alert_rules ADD COLUMN acknowledged_until TEXT;
ALTER TABLE alert_rules ADD COLUMN acknowledged_by TEXT;
