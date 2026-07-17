# Alert Webhook Presets (Slack / Discord) — Design

**Date:** 2026-07-18
**Status:** Approved (user delegated selection; next unchecked Phase 13 item)

## Problem

Alert rules POST a LogHarbor-shaped JSON object to their webhook URL. Slack and
Discord incoming webhooks reject that shape — they require `{"text": ...}` and
`{"content": ...}` respectively — so today the two most common chat targets need
a relay in between. todo.md Phase 13: "Slack and Discord payload formats
selectable per rule (current raw JSON stays as 'generic')."

## Data model

Migration `009_alert_payload_format.sql`:
`ALTER TABLE alert_rules ADD COLUMN payload_format TEXT NOT NULL DEFAULT 'generic';`

`AlertRule` gains `PayloadFormat` (string: `generic` | `slack` | `discord`).
The column appends to the END of the store's column list so existing reader
indexes keep their positions.

## Behavior

`AlertEvaluator` builds the payload per rule:

- `generic` — the current structured object, byte-for-byte unchanged
  (rule/signal/filter/count/threshold/windowMinutes/from/to).
- `slack` — `{"text": "<message>"}`.
- `discord` — `{"content": "<message>"}`.

Shared message text:
`LogHarbor alert '<rule>': <count> events matched '<signal>' in the last <window> min (threshold <threshold>).`

## API

`AlertRequest` gains optional `payloadFormat`; omitted -> `generic`; anything
outside the three values -> 400 validation problem. Responses carry the field.

## Frontend

`AlertForm`: a Select with the three formats (default generic); `AlertRequest`
type and edit-flow initial values carry it. i18n labels in en/tr.

## Tests (first coverage for the alert stack)

- Evaluator integration (real stores from the test factory, recording
  IWebhookSender): slack rule fires `{"text": ...}` containing rule title and
  count; discord fires `{"content": ...}`; generic keeps the structured shape.
- Endpoint: invalid `payloadFormat` -> 400; omitted -> response says `generic`;
  explicit `discord` -> persisted and returned.

## Docs

docs/api.md ALERTS section; docs/frontend.md alerts line.

## Out of scope

Rich formatting (Slack blocks / Discord embeds), per-format test-fire button,
retry policy changes.
