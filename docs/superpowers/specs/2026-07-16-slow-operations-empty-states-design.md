# Slow-Operations Empty States — Design

**Date:** 2026-07-16
**Status:** approved, ready for planning

## Problem

The Analysis page's "Slower than usual" card renders nothing while a real regression is in
flight, and the user reads that as "no slowdown". Found by the anomaly test harness
(`test/anomaly-test/`) against the live test server.

`GET /api/stats/slow-operations` treats the selected `from` as the **split** between baseline
and current, not as the start of the analysed window (`StatsEndpoints.cs:97` passes
`baselineFromUtc = 2000-01-01`, `splitUtc = from`). Baseline is therefore *everything older
than the selected range*. This is the documented, intended semantics (`docs/api.md:168`) and it
works well on narrow ranges — but on the page's 24 h default an operation whose history is
younger than 24 h has an **empty baseline** and can never be listed, at any threshold.

Measured against a live ramp (60 → 600 ms, regression ongoing, operation ~1 h old):

| Range | Params | Result |
|---|---|---|
| last 10 min | UI defaults | `×3.8` (70 → 267 ms) |
| last 30 min | UI defaults (`minSamples=20`) | `[]` — baseline under the sample gate |
| last 30 min | `minSamples=5&floorMs=40` | `×4.3` — the data was there |
| last 24 h (page default) | `minSamples=1&floorMs=1` | `[]` — baseline empty, no gate can help |

The harm is not the empty result; it is that an empty result is **indistinguishable from
"nothing regressed"**. The card says the same thing whether the operation is healthy, has no
timed events at all, or simply has no history to compare against.

(A separate bug — time-range presets never applying on Analysis and Dashboard — is fixed on
`fix/analysis-time-range-presets` and is not in scope here.)

## Decisions

**Baseline semantics stay as they are.** Baseline = the group's entire history before `from`.
This is maximally permissive: an unbounded baseline maximises sample count and spans the
operation's healthy era, which is why narrow ranges detect a sustained regression at ×8.7.
A bounded trailing window (e.g. "previous 24 h vs last 24 h") was considered and **rejected**:
it shrinks the baseline, and for a sustained regression both windows sit at the degraded level,
so the ratio collapses to ~1.0 and the regression stops being detected. It would trade a
silent-empty bug for a silent-miss bug.

**The page's 24 h default stays.** The same picker feeds Top errors and Top exceptions, where
24 h is the primary view. The fix teaches the user to narrow the range instead of degrading two
cards to rescue a third.

**The card explains itself.** The endpoint reports *why* the list is empty; the UI renders a
distinct message per reason.

## Design

### Backend

`SlowOperation` is unchanged. The store method returns a result record instead of a bare list:

```csharp
/// <summary>Regressed groups plus why the list may be empty.</summary>
public sealed record SlowOperationsResult(
    IReadOnlyList<SlowOperation> Operations, long TimedOperationCount, long ComparableOperationCount);
```

- `TimedOperationCount` — groups with **at least one** event carrying a numeric `property` in the
  current window `[from, to)`. Deliberately not gated by `minSamples`: this count answers "is any
  duration data arriving at all?", a setup question, and a group with three samples must not be
  reported as "no duration data".
- `ComparableOperationCount` — groups with >= `minSamples` samples in **both** windows, i.e.
  groups eligible for the ratio test. A group fails this either by having no baseline at all or
  by having too few baseline samples; both have the same remedy (narrow the range, which moves
  events out of the current window and into the baseline), so one message serves both.

`floorMs` does **not** enter `ComparableOperationCount`. A group whose baseline p95 is below the
floor is deliberately "too fast to care about", not "unknown history" — it belongs to the
nothing-regressed case.

The existing query already builds a `p` CTE of `(tmpl, cur, n, p95)`. The counts come from the
same CTE, so the shared `WITH v ... r ... p ...` prefix is extracted into one SQL fragment used
by both the rows query and the counts query on the same connection (SQLite cannot share a CTE
across statements).

Endpoint response:

```json
{ "operations": [ { "template": "...", "baselineP95": 70, "currentP95": 606, "count": 88 } ],
  "timedOperationCount": 3,
  "comparableOperationCount": 0 }
```

Query parameters, guardrail defaults, and ordering are untouched.

### Frontend

`useSlowOperations` surfaces the two counts. The card renders exactly one of four states:

| Condition | Message |
|---|---|
| `operations.length > 0` | the table |
| `timedOperationCount === 0` | "No operation reports an `Elapsed` duration in this range." |
| `comparableOperationCount === 0` | "No operation has enough history before the selected range to compare against. Try a narrower range." |
| otherwise | "No operations are slower than usual." |

This replaces `noSlowOpsBefore`/`noSlowOpsAfter`, which conflate "no timed data" with "nothing
regressed". New i18n keys in `en.ts` and `tr.ts`; the property name stays interpolated so the
message names the actual property.

The current guard is `slow.data?.operations.length === 0`, so on a failed query (`data`
undefined) no message renders at all — a blank table. Rendering keys off the loaded data, and
the query error surfaces through the page's existing `queryError` banner, which must include
the slow query alongside `errors` and `exceptions`.

### Data flow

`AnalysisPage` → `useSlowOperations(range)` → `getSlowOperations` → `GET /api/stats/slow-operations`
→ `SlowOperationsAsync` (validate, unchanged split) → `IEventStore.GetSlowOperationsAsync`
→ one connection, two statements over a shared CTE → `SlowOperationsResult`.

### Testing (TDD — test first, watch it fail)

- **Store unit test:** a group with current-window samples but no baseline → `Operations` empty,
  `TimedOperationCount` 1, `ComparableOperationCount` 0. A group with both windows populated →
  counted as comparable. A group with a handful of current samples (below `minSamples`) still
  counts as timed, so the setup message never fires while duration data is arriving.
- **Endpoint test:** the new JSON fields; the existing
  `SlowOperations_FlagsGroupsSlowerThanTheirBaseline` must keep passing unchanged.
- **Frontend tests:** one per empty state (no timed ops / no baseline / nothing regressed), plus
  the existing preset test. Mock `../api/stats` as the other page tests do.

### Docs

- `docs/api.md` — the slow-operations response shape and what the two counts mean.
- `docs/frontend.md` — the card's four states, if it describes the card.

## Out of scope

- Changing baseline semantics or the split (rejected above, with evidence).
- A push/latency alert on p95 (harness finding; separate work).
- The `DurationMs` vs `Elapsed` convention mismatch between `seed-demo` and this endpoint.
- The committed `wwwroot` bundle being stale build output.
