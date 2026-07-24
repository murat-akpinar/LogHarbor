# db-query-sim

One-shot backfill for the **Queries** page (`/queries`): sends EF Core-shaped
`Executed DbCommand` events — six canned SQL statements with different
call-rate and latency profiles, plus a few Error-level timeouts (with a stack
trace, so the Exceptions page's Source column has data too).

```bash
cd test/db-query-sim
cp .env.example .env    # fill in the API key
python db-query-sim.py                 # 400 events over the last hour
python db-query-sim.py --count 1000 --minutes 240
```

The events are tagged `Source=db-query-sim`, so they never merge with
traffic-sim's groups and can be filtered away with
`not Source = 'db-query-sim'`.

Answers the question: "what does a populated Queries page look like right
now?" — traffic-sim also emits query events continuously, but only from the
moment it runs; this script backfills instantly.
