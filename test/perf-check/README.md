# perf-check

Opens every LogHarbor page in a real browser and prints what each one cost.

It exists because every number behind the 2026-07-31 performance work — entrance
motion 1128ms → 440ms, Requests 56 API calls → 5, 1262 animated elements → 2 —
came from throwaway scripts that no longer exist. None of it could be re-run, so
none of it could be defended, and the next regression was going to be found the
way the last one was: by someone noticing a page felt slow.

**No thresholds and no assertions.** A check that fails the build on a slow laptop
gets deleted the second time it cries wolf, and then there is no check at all.
Read the numbers and compare them to the baseline below.

## Running it

```sh
npm install
npx playwright install chromium     # ~130 MB, once

node perf-check.mjs                 # the one worth comparing over time
```

That builds the API, starts it on port 5199 against a throwaway SQLite file,
seeds 18,000 events from a fixed PRNG seed, drives the pages, prints the table,
and deletes everything. It invents its own admin password for that instance and
nothing outside it ever sees it — no credential of yours is involved.

Two minutes, most of it the first `dotnet build`.

```sh
node perf-check.mjs --events 4000   # quicker, not comparable to the baseline
node perf-check.mjs --headed        # watch it
node perf-check.mjs --help
```

To measure a running server instead, which is a snapshot rather than a baseline
(its data is whatever is in it that day):

```sh
LOGHARBOR_ADMIN_PASS=... node perf-check.mjs \
  --url http://192.168.1.131:5000 --password-env LOGHARBOR_ADMIN_PASS
```

It needs the **admin password**, for the session cookie the pages sit behind. It
does not need an ingestion API key: it only seeds the instance it starts itself.

## The columns

| column | what it is |
|---|---|
| `reqs` / `api` | resources fetched, and how many of them were `/api/` |
| `KB` | bytes over the wire (compressed) |
| `lastApi` | ms until the last `/api` call answered — when the data was ready |
| `settle` | ms until the last animation stopped — when the page looked ready |
| `gap` | `settle - lastApi`: motion still running after the data had arrived |
| `peak` | most elements animating at one moment |
| `rows~` | best-effort table-row count, context for `api` only |

`gap` and `peak` are the two nobody was watching. Duration is the wrong lever —
the count is the lever; halving durations twice did not fix the pages, and
removing chart motion did. `rows~` is honest about being approximate: pages mark
rows differently and Events renders a virtualised list it cannot see.

Below the table it lists any `/api` path called more than twice on one page. A
handful is one call per chart and is fine. What is not fine is a count that
tracks the row count — 50 rows each fetching their own histogram is the N+1 that
has now been introduced and removed twice and never showed up in a unit test.

The first row is a **cold load** with an empty cache; every row after it is a
client-side navigation by clicking the real nav link, which is how anyone
actually moves through the app and the only way the QueryClient's `staleTime`
shows up at all.

## Baseline, 2026-08-01

18,000 events, seed 20260801, bundle `index-rLXUmPpK.js`, 1440x900, this laptop.
Absolute ms will differ on other hardware; the shape is what to compare.

```
page        reqs  api   KB  lastApi  settle  gap  peak  rows~
cold load     21   17  287      178     453  275     9      0
Events         5    3    7       82     283  200     3      0
Requests       4    4    2       90     313  222     8     10
Exceptions     4    4    1       55     280  225     7      3
Queries        3    3    1       56     304  248     8      4
Services       5    5    1       67     331  264     7      3
Users          1    1    1       52     309  257     7     40
Analysis       8    8    2      192     286   93     9      7
Signals        0    0    0        -     309    -     8      0
Alerts         1    1    0       41     327  286     8      0
Settings       1    1    0       42     322  280     8      0
Dashboard     16   16    7      162     390  228    17      0
```

Only `/api/stats/histogram` repeats, 3–4 times a page: one per chart, not per row.

Two of these line up with what was recorded by hand in 2026-07-31/08-01, which is
the reason to trust the rest: **Users = 1 API call** (recorded: 1) and **cold
dashboard peak = 9 animated elements** (recorded: 9). The old "Requests 2" and
"Dashboard 9" figures were cold-load measurements; the warm navigations here show
8 and 17, because more plates enter at once on a client-side navigation. Numbers
from the old throwaway scripts and numbers from this one are not interchangeable —
compare this table to itself.

## What it deliberately does not cover

Server-side query cost. That was checked separately on 2026-08-01: `EXPLAIN QUERY
PLAN` on the histogram, summary and user-activity queries all report
`SEARCH events USING INDEX ix_events_timestamp` — no table scans, no missing
index. The slow part was never SQLite.
