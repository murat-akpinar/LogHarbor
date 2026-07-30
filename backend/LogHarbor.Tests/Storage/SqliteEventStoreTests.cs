using Microsoft.Data.Sqlite;
using LogHarbor.Core.Events;
using LogHarbor.Core.Query;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Storage;

public sealed class SqliteEventStoreTests : IDisposable
{
    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"logharbor-test-{Guid.NewGuid():N}.db");

    private readonly LogHarborDb _db;
    private readonly SqliteEventStore _store;

    public SqliteEventStoreTests()
    {
        _db = new LogHarborDb(_dbPath);
        MigrationRunner.Apply(_db, Path.Combine(AppContext.BaseDirectory, "Migrations"));
        _store = new SqliteEventStore(_db);
    }

    private static Event MakeEvent(string message = "hello", string? properties = null) => new(
        Id: 0,
        Timestamp: "2026-07-13T10:00:00.0000000Z",
        Level: "Information",
        Message: message,
        MessageTemplate: null,
        Properties: properties,
        Exception: null,
        IngestedAt: "2026-07-13T10:00:01.0000000Z");

    private const string LagFrom = "2026-07-13T00:00:00.0000000Z";
    private const string LagTo = "2026-07-13T23:59:59.9999999Z";

    /// <summary>Event stamped at 10:00 that arrived <paramref name="lagSeconds"/> later.</summary>
    private static Event Lagged(string message, double lagSeconds)
    {
        var stamped = DateTimeOffset.Parse("2026-07-13T10:00:00Z");
        return MakeEvent(message) with
        {
            Timestamp = ClefParser.FormatTimestamp(stamped),
            IngestedAt = ClefParser.FormatTimestamp(stamped.AddSeconds(lagSeconds)),
        };
    }

    /// <summary>Event at a given minute past 10:00 carrying an Elapsed of <paramref name="ms"/>.</summary>
    private static Event Timed(int minute, double? ms)
    {
        var stamped = DateTimeOffset.Parse("2026-07-13T10:00:00Z").AddMinutes(minute);
        return MakeEvent($"op at {minute}", ms is null ? null : $"{{\"Elapsed\":{ms}}}") with
        {
            Timestamp = ClefParser.FormatTimestamp(stamped),
        };
    }

    private static readonly DateTimeOffset LatencyFrom = DateTimeOffset.Parse("2026-07-13T10:00:00Z");
    private static readonly DateTimeOffset LatencyTo = DateTimeOffset.Parse("2026-07-13T10:40:00Z");

    [Fact]
    public async Task Latency_AveragesAndRanksTheRangeAndEachBucket()
    {
        // four 10-minute buckets: the first slow, the second quick, the fourth slow again
        await _store.WriteBatchAsync(
        [
            Timed(0, 100), Timed(1, 200), Timed(2, 300),
            Timed(10, 10), Timed(11, 20),
            Timed(30, 900), Timed(31, 1000),
        ]);

        var result = await _store.GetLatencyAsync(null, LatencyFrom, LatencyTo, buckets: 4);

        Assert.Equal(7, result.Sampled);
        Assert.Equal(361.43, Math.Round(result.AvgMs!.Value, 2));
        // ranked over all seven, so the p95 is the slowest sample rather than any bucket's own
        Assert.Equal(1000, result.P95Ms);
        Assert.Equal(4, result.Buckets.Count);
        Assert.Equal(200, result.Buckets[0].AvgMs);
        Assert.Equal(15, result.Buckets[1].AvgMs);
        Assert.Equal(950, result.Buckets[3].AvgMs);
    }

    [Fact]
    public async Task Latency_SaysNothingRatherThanZeroWhereNoEventWasTimed()
    {
        await _store.WriteBatchAsync([Timed(0, 100), Timed(11, null)]);

        var result = await _store.GetLatencyAsync(null, LatencyFrom, LatencyTo, buckets: 4);

        // an untimed bucket is not a fast one, and a chart that drew it as 0 would say it was
        Assert.Equal(100, result.Buckets[0].AvgMs);
        Assert.Null(result.Buckets[1].AvgMs);
        Assert.Null(result.Buckets[2].P95Ms);
        Assert.Equal(1, result.Sampled);
    }

    [Fact]
    public async Task Latency_ReportsNothingSampledWhenNothingCarriesElapsed()
    {
        await _store.WriteBatchAsync([Timed(0, null), Timed(20, null)]);

        var result = await _store.GetLatencyAsync(null, LatencyFrom, LatencyTo, buckets: 4);

        Assert.Equal(0, result.Sampled);
        Assert.Null(result.AvgMs);
        Assert.Null(result.P95Ms);
        Assert.All(result.Buckets, bucket => Assert.Null(bucket.AvgMs));
    }

    [Fact]
    public async Task IngestionLag_ReportsPercentilesAndTheWorstArrival()
    {
        await _store.WriteBatchAsync(
        [
            Lagged("a", 1), Lagged("b", 1), Lagged("c", 2), Lagged("d", 2),
            Lagged("e", 3), Lagged("f", 4), Lagged("g", 5), Lagged("h", 6),
            Lagged("i", 7), Lagged("backfill", 604800), // a week late, the shape a backfill has
        ]);

        var lag = await _store.GetIngestionLagAsync(null, LagFrom, LagTo, lateAfterSeconds: 60);

        Assert.Equal(10, lag.Total);
        Assert.Equal(1, lag.LateCount);            // only the backfill is past 60 s
        Assert.Equal(0, lag.SkewedCount);
        Assert.Equal(604800, lag.MaxSeconds, 3);
        Assert.Equal(3, lag.P50Seconds, 3);        // 5th of 10 by rank
        Assert.Equal(604800, lag.P95Seconds, 3);
        // the UI points at this event, so it has to be the actually-worst one
        Assert.Equal("2026-07-13T10:00:00.0000000Z", lag.WorstTimestamp);
        Assert.Equal("2026-07-20T10:00:00.0000000Z", lag.WorstIngestedAt);
    }

    [Fact]
    public async Task IngestionLag_CountsClockSkewSeparatelyFromLateness()
    {
        await _store.WriteBatchAsync(
        [
            Lagged("ontime", 1),
            Lagged("skewed", -3600),  // stamped an hour ahead of its own arrival
            Lagged("late", 120),
        ]);

        var lag = await _store.GetIngestionLagAsync(null, LagFrom, LagTo, lateAfterSeconds: 60);

        Assert.Equal(3, lag.Total);
        Assert.Equal(1, lag.LateCount);
        Assert.Equal(1, lag.SkewedCount);
        // the skewed event must not drag the percentiles below zero and hide the late one
        Assert.True(lag.P50Seconds >= 0, $"p50 was {lag.P50Seconds}");
        Assert.Equal(120, lag.MaxSeconds, 3);
    }

    [Fact]
    public async Task IngestionLag_EmptyRange_ReadsAsZeroNotNull()
    {
        var lag = await _store.GetIngestionLagAsync(null, LagFrom, LagTo, lateAfterSeconds: 60);

        Assert.Equal(0, lag.Total);
        Assert.Equal(0, lag.MaxSeconds);
        Assert.Null(lag.WorstTimestamp);
    }

    [Fact]
    public async Task IngestionLag_HonoursTheFilter()
    {
        await _store.WriteBatchAsync(
        [
            Lagged("kept", 300) with { Level = "Error" },
            Lagged("dropped", 900),
        ]);

        var filter = SqlTranslator.Translate(QueryParser.Parse("@Level = 'Error'"));
        var lag = await _store.GetIngestionLagAsync(filter, LagFrom, LagTo, lateAfterSeconds: 60);

        Assert.Equal(1, lag.Total);
        Assert.Equal(300, lag.MaxSeconds, 3);
    }

    [Fact]
    public async Task ServiceOverview_CoalescesSpellings_CountsErrors_ComputesP95()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("a", """{"service.name":"checkout","Elapsed":10}"""),
            MakeEvent("b", """{"service.name":"checkout","Elapsed":100}""") with { Level = "Error" },
            MakeEvent("c", """{"service.name":"checkout","Elapsed":50}"""),
            // the CLEF/Seq spelling merges into the same service
            MakeEvent("d", """{"Service":"checkout"}""") with { Level = "Fatal" },
            MakeEvent("e", """{"Service":"worker"}"""),
            // no service identity -> stays off the page
            MakeEvent("f", """{"UserId":1}"""),
            MakeEvent("g"),
        ]);

        var rows = await _store.GetServiceOverviewAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-14T00:00:00.0000000Z", 50);

        Assert.Equal(2, rows.Count);
        Assert.Equal("checkout", rows[0].Service);
        Assert.Equal(4, rows[0].Total);
        Assert.Equal(2, rows[0].ErrorCount);
        Assert.Equal(100, rows[0].P95ElapsedMs);
        Assert.Equal("worker", rows[1].Service);
        Assert.Equal(1, rows[1].Total);
        Assert.Equal(0, rows[1].ErrorCount);
        Assert.Null(rows[1].P95ElapsedMs);
    }

    [Fact]
    public async Task ServiceOverview_RespectsRangeBounds()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("in", """{"Service":"api"}"""),
            MakeEvent("out", """{"Service":"api"}""") with { Timestamp = "2026-07-12T10:00:00.0000000Z" },
        ]);

        var rows = await _store.GetServiceOverviewAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-14T00:00:00.0000000Z", 50);

        Assert.Equal(1, Assert.Single(rows).Total);
    }

    [Fact]
    public async Task ServiceStatus_KeepsOnlyTheNewestReadingPerHostAndService()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("old", """{"Source":"service-probe","host":"web-1","kind":"systemd","service":"nginx","up":1,"state":"active"}""")
                with { Timestamp = "2026-07-13T10:00:00.0000000Z" },
            MakeEvent("new", """{"Source":"service-probe","host":"web-1","kind":"systemd","service":"nginx","up":0,"state":"failed"}""")
                with { Timestamp = "2026-07-13T10:05:00.0000000Z" },
            // same service name on another host is another row, never a merge
            MakeEvent("other host", """{"Source":"service-probe","host":"web-2","kind":"systemd","service":"nginx","up":1,"state":"active"}""")
                with { Timestamp = "2026-07-13T10:04:00.0000000Z" },
            // ordinary application logs never reach the board
            MakeEvent("app", """{"Service":"nginx","Elapsed":10}"""),
        ]);

        var rows = await _store.GetServiceStatusAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-14T00:00:00.0000000Z", "service-probe", 100);

        Assert.Equal(2, rows.Count);
        var first = Assert.Single(rows, row => row.Host == "web-1");
        Assert.Equal(0, first.Up);
        Assert.Equal("failed", first.State);
        Assert.Equal("systemd", first.Kind);
        Assert.Equal("2026-07-13T10:05:00.0000000Z", first.LastSeen);
        Assert.Equal(1, Assert.Single(rows, row => row.Host == "web-2").Up);
    }

    [Fact]
    public async Task ServiceStatus_ProbeCouldNotTell_ComesBackWithoutUp()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("failed probe", """{"Source":"service-probe","host":"web-1","kind":"docker","service":"api","error":"daemon unreachable"}"""),
        ]);

        var rows = await _store.GetServiceStatusAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-14T00:00:00.0000000Z", "service-probe", 100);

        var row = Assert.Single(rows);
        Assert.Null(row.Up);
        Assert.Null(row.State);
        Assert.Equal("api", row.Service);
    }

    [Fact]
    public async Task ServiceStatus_CarriesDockerHealth()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("sick", """{"Source":"service-probe","host":"web-1","kind":"docker","service":"api","up":1,"state":"running","health":"unhealthy"}"""),
        ]);

        var rows = await _store.GetServiceStatusAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-14T00:00:00.0000000Z", "service-probe", 100);

        Assert.Equal("unhealthy", Assert.Single(rows).Health);
    }

    [Fact]
    public async Task ServiceStatus_RespectsRangeBounds()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("out", """{"Source":"service-probe","host":"web-1","kind":"systemd","service":"cron","up":1,"state":"active"}""")
                with { Timestamp = "2026-07-12T10:00:00.0000000Z" },
        ]);

        var rows = await _store.GetServiceStatusAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-14T00:00:00.0000000Z", "service-probe", 100);

        Assert.Empty(rows);
    }

    /// <summary>A request log writes one message template for every route it serves, so grouping
    /// by the template put the whole application in one row. The route property is what tells
    /// them apart — and the events that do not carry it are still operations.</summary>
    [Fact]
    public async Task OperationOverview_GroupsByRouteWhenTheEventsCarryOne()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("a", """{"Method":"GET","Path":"/orders/{id}","Elapsed":10}""")
                with { MessageTemplate = "Handled {Method} {Path} in {Elapsed} ms" },
            MakeEvent("b", """{"Method":"GET","Path":"/orders/{id}","Elapsed":90}""")
                with { MessageTemplate = "Handled {Method} {Path} in {Elapsed} ms", Level = "Error" },
            MakeEvent("c", """{"Method":"POST","Path":"/orders","Elapsed":500}""")
                with { MessageTemplate = "Handled {Method} {Path} in {Elapsed} ms" },
            // same template, no route: a job keeps its template as identity
            MakeEvent("d", """{"Elapsed":20}""") with { MessageTemplate = "Processed job {JobId}" },
            // a path with no verb is a line *about* that path, not its traffic: it must not open a
            // second "/orders/{id}" row whose p95 is measured over a different set of events
            MakeEvent("e", """{"Path":"/orders/{id}","Elapsed":3000}""")
                with { MessageTemplate = "Slow request {Path} took {Elapsed} ms" },
        ]);

        var rows = await _store.GetOperationOverviewAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-14T00:00:00.0000000Z", "Path", "Method", 50);

        Assert.Equal(4, rows.Count);
        Assert.Equal("Slow request {Path} took {Elapsed} ms", rows.Single(row => row.Route is null && row.Total == 1 && row.P95ElapsedMs == 3000).Template);

        var get = rows.Single(row => row.Template == "GET /orders/{id}");
        Assert.Equal("GET", get.Method);
        Assert.Equal("/orders/{id}", get.Route);
        Assert.Equal(2, get.Total);
        Assert.Equal(1, get.ErrorCount);
        Assert.Equal(90, get.P95ElapsedMs);

        // the same template, a different verb: two rows, not one
        var post = rows.Single(row => row.Template == "POST /orders");
        Assert.Equal(500, post.P95ElapsedMs);

        var job = rows.Single(row => row.Template == "Processed job {JobId}");
        Assert.Null(job.Route);
        Assert.Null(job.Method);
    }

    /// <summary>An app that logs the raw path instead of the route template gave every request
    /// its own group: one row per order id, each with a total of 1 and a p95 measured over that
    /// single sample, while the route they all belong to never appeared at all.</summary>
    [Fact]
    public async Task OperationOverview_FoldsIdsOutOfRawPathsIntoOneRoute()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("a", """{"Method":"GET","Path":"/api/orders/41973","Elapsed":10}""")
                with { MessageTemplate = "HTTP {Method} {Path} responded" },
            MakeEvent("b", """{"Method":"GET","Path":"/api/orders/8","Elapsed":90}""")
                with { MessageTemplate = "HTTP {Method} {Path} responded", Level = "Error" },
            MakeEvent("c", """{"Method":"GET","Path":"/api/orders/3f2504e0-4f89-11d3-9a0c-0305e82c3301","Elapsed":50}""")
                with { MessageTemplate = "HTTP {Method} {Path} responded" },
            // no id to fold: this route stays exactly as it was logged
            MakeEvent("d", """{"Method":"GET","Path":"/api/orders","Elapsed":5}""")
                with { MessageTemplate = "HTTP {Method} {Path} responded" },
        ]);

        var rows = await _store.GetOperationOverviewAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-14T00:00:00.0000000Z", "Path", "Method", 50);

        Assert.Equal(2, rows.Count);

        var byId = rows.Single(row => row.Route == "/api/orders/{id}");
        Assert.Equal(3, byId.Total);
        Assert.Equal(1, byId.ErrorCount);
        Assert.Equal(90, byId.P95ElapsedMs);
        // the deep link cannot use "Path = '/api/orders/{id}'": no event carries that text
        Assert.True(byId.Folded);

        var list = rows.Single(row => row.Route == "/api/orders");
        Assert.Equal(1, list.Total);
        Assert.False(list.Folded);
    }

    /// <summary>The install whose sink already logs route templates is the one that reads well
    /// today, so folding has to leave it byte for byte alone — and leave it filterable by "=".</summary>
    [Fact]
    public async Task OperationOverview_LeavesTemplatedPathsUnfolded()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("a", """{"Method":"GET","Path":"/api/orders/{id}","Elapsed":10}""")
                with { MessageTemplate = "HTTP {Method} {Path} responded" },
            MakeEvent("b", """{"Method":"DELETE","Path":"/api/carts/{cartId}/items/{itemId}","Elapsed":20}""")
                with { MessageTemplate = "HTTP {Method} {Path} responded" },
        ]);

        var rows = await _store.GetOperationOverviewAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-14T00:00:00.0000000Z", "Path", "Method", 50);

        Assert.Equal("/api/orders/{id}", rows.Single(row => row.Method == "GET").Route);
        Assert.Equal("/api/carts/{cartId}/items/{itemId}", rows.Single(row => row.Method == "DELETE").Route);
        Assert.All(rows, row => Assert.False(row.Folded));
    }

    /// <summary>Serilog writes RequestPath, OTel writes http.route: the names are settings.</summary>
    [Fact]
    public async Task OperationOverview_TakesTheRoutePropertyNameFromTheCaller()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("a", """{"RequestMethod":"PUT","RequestPath":"/cart","Elapsed":12}""")
                with { MessageTemplate = "HTTP {RequestMethod} {RequestPath} responded" },
        ]);

        var rows = await _store.GetOperationOverviewAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-14T00:00:00.0000000Z",
            "RequestPath", "RequestMethod", 50);

        Assert.Equal("PUT /cart", rows.Single().Template);
    }

    [Fact]
    public async Task OperationOverview_GroupsByTemplate_CountsErrors_ComputesP95()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("a", """{"Elapsed":10}""") with { MessageTemplate = "GET /orders" },
            MakeEvent("b", """{"Elapsed":100}""") with { MessageTemplate = "GET /orders", Level = "Error" },
            MakeEvent("c", """{"Elapsed":50}""") with { MessageTemplate = "GET /orders" },
            MakeEvent("d", """{"Elapsed":30}""") with { MessageTemplate = "POST /pay", Level = "Fatal" },
            // no message template -> no operation identity, stays off the page
            MakeEvent("e", """{"Elapsed":5}"""),
        ]);

        var rows = await _store.GetOperationOverviewAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-14T00:00:00.0000000Z", "Path", "Method", 50);

        Assert.Equal(2, rows.Count);
        Assert.Equal("GET /orders", rows[0].Template);
        // no route property on these events, so the template is still the identity
        Assert.Null(rows[0].Route);
        Assert.Equal(3, rows[0].Total);
        Assert.Equal(1, rows[0].ErrorCount);
        Assert.Equal(100, rows[0].P95ElapsedMs);
        Assert.Equal("POST /pay", rows[1].Template);
        Assert.Equal(1, rows[1].Total);
        Assert.Equal(1, rows[1].ErrorCount);
        Assert.Equal(30, rows[1].P95ElapsedMs);
    }

    [Fact]
    public async Task UserActivity_GroupsByProperty_CountsErrors_TracksLastSeen()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("a", """{"UserId":"u1"}"""),
            MakeEvent("b", """{"UserId":"u1"}""") with { Level = "Error", Timestamp = "2026-07-13T10:30:00.0000000Z" },
            MakeEvent("c", """{"UserId":"u2"}""") with { Timestamp = "2026-07-13T10:05:00.0000000Z" },
            // no UserId property -> no user identity, excluded
            MakeEvent("d", """{"OrderId":9}"""),
        ]);

        var rows = await _store.GetUserActivityAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-14T00:00:00.0000000Z", "UserId", 50);

        Assert.Equal(2, rows.Count);
        Assert.Equal("u1", rows[0].Value);
        Assert.Equal(2, rows[0].Total);
        Assert.Equal(1, rows[0].ErrorCount);
        Assert.Equal("2026-07-13T10:30:00.0000000Z", rows[0].LastSeen);
        Assert.Equal("u2", rows[1].Value);
        Assert.Equal(1, rows[1].Total);
        Assert.Equal(0, rows[1].ErrorCount);
    }

    [Fact]
    public async Task WriteBatch_PersistsAllFields()
    {
        var written = MakeEvent(properties: """{"UserId":7}""") with
        {
            MessageTemplate = "tpl {UserId}",
            Exception = "boom",
        };

        await _store.WriteBatchAsync([written]);

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT timestamp, level, message, message_template, properties, exception, ingested_at FROM events;";
        using var reader = command.ExecuteReader();
        Assert.True(reader.Read());
        Assert.Equal(written.Timestamp, reader.GetString(0));
        Assert.Equal(written.Level, reader.GetString(1));
        Assert.Equal(written.Message, reader.GetString(2));
        Assert.Equal(written.MessageTemplate, reader.GetString(3));
        Assert.Equal(written.Properties, reader.GetString(4));
        Assert.Equal(written.Exception, reader.GetString(5));
        Assert.Equal(written.IngestedAt, reader.GetString(6));
        Assert.False(reader.Read());
    }

    [Fact]
    public async Task WriteBatch_NullOptionalFields_StoredAsNull()
    {
        await _store.WriteBatchAsync([MakeEvent()]);

        Assert.Equal(1L, Scalar(
            "SELECT COUNT(*) FROM events WHERE message_template IS NULL AND properties IS NULL AND exception IS NULL;"));
    }

    [Fact]
    public async Task WriteBatch_ManyEvents_AllStored()
    {
        var events = Enumerable.Range(0, 250).Select(i => MakeEvent($"event {i}")).ToList();

        await _store.WriteBatchAsync(events);

        Assert.Equal(250L, Scalar("SELECT COUNT(*) FROM events;"));
    }

    [Fact]
    public async Task WriteBatch_EmptyList_IsNoOp()
    {
        await _store.WriteBatchAsync([]);

        Assert.Equal(0L, Scalar("SELECT COUNT(*) FROM events;"));
    }

    [Fact]
    public async Task WriteBatch_ReturnsInsertedIds_InOrder()
    {
        var ids = await _store.WriteBatchAsync([MakeEvent("a"), MakeEvent("b"), MakeEvent("c")]);

        Assert.Equal(3, ids.Count);
        Assert.Equal(ids.OrderBy(id => id), ids);
        var stored = await _store.MatchAsync(null, ids);
        Assert.Equal(["c", "b", "a"], stored.Select(e => e.Message));
    }

    [Fact]
    public async Task Match_WithFilter_ReturnsOnlyMatchingIds()
    {
        var ids = await _store.WriteBatchAsync(
        [
            MakeEvent("first") with { Level = "Error" },
            MakeEvent("second") with { Level = "Information" },
        ]);
        var filter = SqlTranslator.Translate(QueryParser.Parse("@Level = 'Error'"));

        var matched = await _store.MatchAsync(filter, ids);

        Assert.Equal("first", Assert.Single(matched).Message);
    }

    [Fact]
    public async Task Match_OnlyConsidersGivenIds()
    {
        var older = await _store.WriteBatchAsync([MakeEvent("older")]);
        var newer = await _store.WriteBatchAsync([MakeEvent("newer")]);

        var matched = await _store.MatchAsync(null, newer);

        Assert.Equal("newer", Assert.Single(matched).Message);
        Assert.DoesNotContain(older[0], matched.Select(e => e.Id));
    }

    [Fact]
    public async Task Match_EmptyIds_ReturnsEmpty()
    {
        await _store.WriteBatchAsync([MakeEvent()]);

        Assert.Empty(await _store.MatchAsync(null, []));
    }

    /// <summary>
    /// Regression: one bound parameter per id hit SQLite's 32766-variable ceiling. MaxBatchBytes
    /// is 5 MB and a minimal CLEF line is ~30 bytes, so one accepted request can carry far more
    /// than that — the command threw, TailBroadcaster logged it, and every live-tail subscriber
    /// silently missed the whole batch.
    /// </summary>
    [Fact]
    public async Task Match_BatchLargerThanTheSqliteParameterLimit_ReturnsEveryEvent()
    {
        var events = Enumerable.Range(0, 40_000).Select(index => MakeEvent($"event {index}")).ToList();
        var ids = await _store.WriteBatchAsync(events);

        var matched = await _store.MatchAsync(null, ids);

        Assert.Equal(ids.Count, matched.Count);
        // still one descending list, so the tail prepends in the right order
        Assert.Equal(matched.Select(item => item.Id).OrderByDescending(id => id), matched.Select(item => item.Id));
    }

    [Fact]
    public async Task Match_LargeBatchWithFilter_AppliesTheFilterToEveryChunk()
    {
        var events = Enumerable.Range(0, 2_000)
            .Select(index => MakeEvent($"event {index}") with { Level = index % 2 == 0 ? "Error" : "Information" })
            .ToList();
        var ids = await _store.WriteBatchAsync(events);
        var filter = SqlTranslator.Translate(QueryParser.Parse("@Level = 'Error'"));

        var matched = await _store.MatchAsync(filter, ids);

        Assert.Equal(1_000, matched.Count);
        Assert.All(matched, item => Assert.Equal("Error", item.Level));
    }

    [Fact]
    public async Task GetHistogram_BucketsEventsByTimeAndLevel()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("a") with { Timestamp = "2026-07-13T10:05:00.0000000Z", Level = "Information" },
            MakeEvent("b") with { Timestamp = "2026-07-13T10:20:00.0000000Z", Level = "Error" },
            MakeEvent("c") with { Timestamp = "2026-07-13T10:50:00.0000000Z", Level = "Error" },
        ]);
        var from = DateTimeOffset.Parse("2026-07-13T10:00:00Z");
        var to = DateTimeOffset.Parse("2026-07-13T11:00:00Z");

        var buckets = await _store.GetHistogramAsync(null, from, to, buckets: 4);

        Assert.Equal(4, buckets.Count);
        Assert.Equal("2026-07-13T10:00:00.0000000Z", buckets[0].Start);
        Assert.Equal("2026-07-13T10:15:00.0000000Z", buckets[1].Start);
        Assert.Equal(1, buckets[0].Counts["Information"]);
        Assert.Equal(0, buckets[0].Counts["Error"]);
        Assert.Equal(1, buckets[1].Counts["Error"]);
        Assert.Equal(0, buckets[2].Counts.Values.Sum());
        Assert.Equal(1, buckets[3].Counts["Error"]);
    }

    [Fact]
    public async Task GetHistogram_EventAtExactUpperBound_ClampsIntoLastBucket()
    {
        await _store.WriteBatchAsync([MakeEvent("edge") with { Timestamp = "2026-07-13T11:00:00.0000000Z" }]);
        var from = DateTimeOffset.Parse("2026-07-13T10:00:00Z");
        var to = DateTimeOffset.Parse("2026-07-13T11:00:00Z");

        var buckets = await _store.GetHistogramAsync(null, from, to, buckets: 4);

        Assert.Equal(1, buckets[3].Counts["Information"]);
    }

    [Fact]
    public async Task GetHistogram_AppliesFilter()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("a") with { Timestamp = "2026-07-13T10:05:00.0000000Z", Level = "Information" },
            MakeEvent("b") with { Timestamp = "2026-07-13T10:05:00.0000000Z", Level = "Error" },
        ]);
        var filter = SqlTranslator.Translate(QueryParser.Parse("@Level = 'Error'"));

        var buckets = await _store.GetHistogramAsync(
            filter, DateTimeOffset.Parse("2026-07-13T10:00:00Z"), DateTimeOffset.Parse("2026-07-13T11:00:00Z"), buckets: 2);

        Assert.Equal(0, buckets[0].Counts["Information"]);
        Assert.Equal(1, buckets[0].Counts["Error"]);
    }

    [Fact]
    public async Task GetHistogram_NoEvents_ReturnsAllZeroBuckets()
    {
        var buckets = await _store.GetHistogramAsync(
            null, DateTimeOffset.Parse("2026-07-13T10:00:00Z"), DateTimeOffset.Parse("2026-07-13T11:00:00Z"), buckets: 3);

        Assert.Equal(3, buckets.Count);
        Assert.All(buckets, bucket => Assert.Equal(0, bucket.Counts.Values.Sum()));
    }

    [Fact]
    public async Task GetSummary_ReturnsTotalAndByLevel()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("a") with { Timestamp = "2026-07-13T10:05:00.0000000Z", Level = "Error" },
            MakeEvent("b") with { Timestamp = "2026-07-13T10:10:00.0000000Z", Level = "Error" },
            MakeEvent("c") with { Timestamp = "2026-07-13T10:15:00.0000000Z", Level = "Warning" },
        ]);

        var summary = await _store.GetSummaryAsync(
            null, "2026-07-13T10:00:00.0000000Z", "2026-07-13T11:00:00.0000000Z");

        Assert.Equal(3, summary.Total);
        Assert.Equal(2, summary.ByLevel["Error"]);
        Assert.Equal(1, summary.ByLevel["Warning"]);
        Assert.Equal(0, summary.ByLevel["Fatal"]);
    }

    [Fact]
    public async Task GetSummary_AppliesFilter()
    {
        await _store.WriteBatchAsync(
        [
            MakeEvent("a") with { Timestamp = "2026-07-13T10:05:00.0000000Z", Level = "Error" },
            MakeEvent("b") with { Timestamp = "2026-07-13T10:10:00.0000000Z", Level = "Warning" },
        ]);
        var filter = SqlTranslator.Translate(QueryParser.Parse("@Level = 'Error'"));

        var summary = await _store.GetSummaryAsync(
            filter, "2026-07-13T10:00:00.0000000Z", "2026-07-13T11:00:00.0000000Z");

        Assert.Equal(1, summary.Total);
        Assert.Equal(1, summary.ByLevel["Error"]);
        Assert.Equal(0, summary.ByLevel["Warning"]);
    }

    [Fact]
    public async Task GetSummary_OutsideTimeRange_Excluded()
    {
        await _store.WriteBatchAsync([MakeEvent("outside") with { Timestamp = "2026-07-13T09:00:00.0000000Z" }]);

        var summary = await _store.GetSummaryAsync(
            null, "2026-07-13T10:00:00.0000000Z", "2026-07-13T11:00:00.0000000Z");

        Assert.Equal(0, summary.Total);
    }

    [Fact]
    public async Task WriteBatch_PersistsTraceAndSpanIds()
    {
        var written = MakeEvent() with
        {
            TraceId = "0af7651916cd43dd8448eb211c80319c",
            SpanId = "b7ad6b7169203331",
        };

        var ids = await _store.WriteBatchAsync([written]);

        var found = await _store.FindAsync(ids[0]);
        Assert.Equal(written.TraceId, found!.TraceId);
        Assert.Equal(written.SpanId, found.SpanId);
    }

    [Fact]
    public async Task WriteBatch_NullTraceIds_StoredAsNull()
    {
        var ids = await _store.WriteBatchAsync([MakeEvent()]);

        var found = await _store.FindAsync(ids[0]);
        Assert.Null(found!.TraceId);
        Assert.Null(found.SpanId);
    }

    [Fact]
    public async Task PropertyValues_WithDottedKey_GroupsTheFlatKey()
    {
        await _store.WriteBatchAsync([MakeEvent(properties: """{"service.name":"checkout"}""")]);

        var rows = await _store.GetPropertyValuesAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-13T23:59:59.9999999Z", "service.name", 10);

        var row = Assert.Single(rows);
        Assert.Equal("checkout", row.Value);
        Assert.Equal(1L, row.Count);
    }

    private object Scalar(string sql)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return command.ExecuteScalar()!;
    }

    public void Dispose()
    {
        _db.ClearPool();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            File.Delete(_dbPath + suffix);
        }
    }
}
