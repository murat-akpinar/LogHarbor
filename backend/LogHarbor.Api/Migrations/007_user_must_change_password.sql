-- 007: force a password change for seeded accounts (docs/api.md AUTH)
-- The first start seeds admin/admin when no password is configured; that account cannot
-- do anything until the password is replaced. Existing accounts keep the default 0.

ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
