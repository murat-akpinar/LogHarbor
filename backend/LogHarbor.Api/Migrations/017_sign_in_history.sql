-- Who signed in, and when. Two shapes, on purpose.
--
-- Local accounts get a column: the row already exists and only needed a timestamp.
--
-- Directory users get their own table rather than rows in `users`. They have no password to
-- keep and their role is re-read from the directory on every login, so a row in `users` would
-- be a mirror that goes stale the moment somebody is moved out of a group — and worse, a row
-- there is a row the local password path has to be careful never to match. This table records
-- that a principal signed in and what the directory said at the time; it grants nothing.
ALTER TABLE users ADD COLUMN last_login_at TEXT;

CREATE TABLE directory_users (
  username      TEXT PRIMARY KEY COLLATE NOCASE,
  last_role     TEXT NOT NULL,   -- what the directory answered at the last sign-in, not a grant
  first_seen_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);
