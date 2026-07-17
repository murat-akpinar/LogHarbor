# Backup Endpoint — Design

**Date:** 2026-07-17
**Status:** Approved

## Problem

The whole server is one SQLite file, but there is no safe way to copy it while
the server runs: a naive file copy can catch the database mid-write and WAL
state lives in side files. todo.md Phase 13: "GET /api/admin/backup streams a
consistent snapshot (VACUUM INTO temp file, safe while the server runs), admin
role only; restore documented in README."

## Endpoint

`GET /api/admin/backup` (new `BackupEndpoints.cs`):

1. On a live connection run `VACUUM INTO '<temp>/logharbor-backup-<guid>.db'` —
   SQLite's supported online-snapshot mechanism: consistent, WAL folded in,
   output compacted. The guid keeps the target unique (VACUUM INTO refuses an
   existing file). The command binds the path as a parameter and honors the
   request's cancellation token; on failure the temp file is deleted.
2. Stream the file back with `FileOptions.DeleteOnClose` (the temp file removes
   itself when the download completes or aborts) as `application/octet-stream`
   with `Content-Disposition: logharbor-backup-YYYYMMDD-HHmmss.db`.

## Authorization

`AuthPolicy.RequiresAdmin` currently lets viewers through every GET. New rule,
checked before the method check: any path under `/api/admin` requires the admin
role regardless of method. While auth is disabled (no users yet) the endpoint
is open, like the rest of the management API.

## Tests

- Ingest an event, download the backup: 200, bytes start with the
  `SQLite format 3` magic, and the written-out file opens as SQLite with the
  expected event count.
- Viewer session -> 403; no session while auth is enabled -> 401.

## Docs and UI

- `docs/api.md`: endpoint entry.
- `README.md` / `README_TR.md`: short "Backup & restore" section — download via
  the Settings link or the endpoint; restore = stop the container, replace
  `logharbor.db` in the data volume with the downloaded file, start again.
- Settings page: one admin-only "Download backup" anchor to `/api/admin/backup`
  (session cookie rides along, the browser handles the download) + two i18n keys.

## Out of scope

Scheduled/automatic backups, retention of backup files, restore-over-HTTP.
