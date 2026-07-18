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
