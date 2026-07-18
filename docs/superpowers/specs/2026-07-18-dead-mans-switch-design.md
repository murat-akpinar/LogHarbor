# Dead Man's Switch Alerts — Design

**Date:** 2026-07-18
**Status:** Approved

## Problem

Alert rules today fire when a signal matches **at least** ThresholdCount
events in a window (`AlertEvaluator`). The inverse is just as important
operationally: a heartbeat that **stops**. A cron that no longer logs its
run, a queue consumer that went quiet, a nightly job that silently died —
today nothing notices. Phase 14 A: one new condition type on the existing
alert machinery, no new ingestion, no new webhook/cooldown plumbing.

## Condition model

Add a discriminator column, not a general comparator (the zero-event rule
below makes a comparator gold-plating):

Migration `010_alert_condition.sql`:
`ALTER TABLE alert_rules ADD COLUMN condition TEXT NOT NULL DEFAULT 'at-least';`

Appended last so existing reader ordinals do not shift (same discipline as
`payload_format`). Values:

- `at-least` — current behavior, the default, so every existing rule keeps
  working untouched.
- `silence` — dead man's switch.

`AlertRule` gains a `Condition` field (read/written by `SqliteAlertStore`,
carried through `CreateAsync`/`UpdateAsync`). ThresholdCount is stored but
unused for `silence` rules (the form sends 0; validation allows 0 when
condition is `silence`).

## Evaluator semantics

In `AlertEvaluator.EvaluateAsync`, per rule, after the existing cooldown
check and signal-filter parse:

- `at-least` (unchanged): fires when `summary.Total >= ThresholdCount` over
  (`now - window`, `now`).
- `silence`: fires when **both** hold:
  1. the window (`now - window`, `now`) has `Total == 0`, and
  2. **proof of life** — (`created_at`, `now - window`) has `Total >= 1`.

  The proof-of-life query runs only when (1) is true, so a busy signal
  costs one query as before. A freshly created rule, or one whose signal
  has never matched, stays quiet — a cron that has never run does not
  scream on day one, and a server restart does not false-alarm.

Cooldown is unchanged for both conditions: after any firing the rule stays
quiet for one full window. Consequence for `silence`: while the service
stays dead, the rule re-fires once per window as a reminder; if the service
recovers and later dies again, it fires again. (Roadmap: "same
webhook/cooldown semantics.")

## Payload / message

`BuildPayload` branches on condition:

- Generic: `silence` rules emit `{ rule, signal, filter, condition:
  "silence", count: 0, windowMinutes, from, to }` (no `threshold` key).
- Slack/Discord message for `silence`:
  `LogHarbor alert '<rule>': signal '<signal>' has been silent for <M> min
  (expected at least one event).`
- `at-least` payload and message are unchanged.

## API + frontend

- `AlertEndpoints.AlertRequest` gains `string? Condition`. Validation:
  Condition, when present, must be `at-least` or `silence` (default
  `at-least`); ThresholdCount must be `>= 1` for `at-least` and may be `0`
  (or absent → 0) for `silence`.
- `AlertForm` adds a condition `<select>` ("at least N events" / "silent
  for N minutes"). When `silence` is selected the threshold input is hidden
  and sent as 0; the window input's label/placeholder becomes the silence
  period. The alert-row summary text (`t.alerts.summary`) branches on
  condition. TR/EN i18n for both.
- `docs/api.md` (ALERTS) and `docs/frontend.md` (ALERTS PAGE) updated to
  describe the condition field and silence semantics.

## Tests

- `AlertEvaluatorTests`: silence fires on zero-in-window + prior activity;
  silence does NOT fire when the signal never matched (no proof of life);
  silence does NOT fire when the window has events; silence respects the
  one-window cooldown; existing `at-least` tests still pass unchanged.
- `AlertEndpointsTests`: create/update round-trips condition (this also
  covers store persistence, as it exercises `SqliteAlertStore`); validation
  rejects an unknown condition; a `silence` rule with ThresholdCount 0 is
  accepted; an `at-least` rule with ThresholdCount 0 is rejected.
- Frontend `AlertForm` test: choosing "silent for N minutes" hides the
  threshold input and the submitted request carries `condition: 'silence'`.

## Out of scope

Fewer-than-N (low-volume) alerts, per-condition cooldown tuning,
fire-once-until-recovery, notifying on recovery ("service is back").
