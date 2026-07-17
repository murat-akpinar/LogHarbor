using Microsoft.Data.Sqlite;
using LogHarbor.Core.Archiving;
using LogHarbor.Core.Events;
using LogHarbor.Core.Query;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Archiving;

public sealed class ArchiverTests : IDisposable
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-13T12:00:00Z");

    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"logharbor-test-{Guid.NewGuid():N}.db");

    private readonly string _archiveDir =
        Path.Combine(Path.GetTempPath(), $"logharbor-test-archive-{Guid.NewGuid():N}");

    private readonly LogHarborDb _db;
    private readonly SqliteEventStore _eventStore;
    private readonly SqliteArchiveStore _archiveStore;
    private readonly SqliteSettingsStore _settingsStore;
    private readonly Archiver _archiver;

    public ArchiverTests()
    {
        _db = new LogHarborDb(_dbPath);
        MigrationRunner.Apply(_db, Path.Combine(AppContext.BaseDirectory, "Migrations"));
        _eventStore = new SqliteEventStore(_db);
        _archiveStore = new SqliteArchiveStore(_db);
        _settingsStore = new SqliteSettingsStore(_db,
            new ArchiveSettings { CompressAfterDays = 30, HydrationKeepDays = 1, RetentionDays = 365 });
        _archiver = new Archiver(_archiveStore, _settingsStore, _archiveDir);
    }

    private static Event MakeEvent(string timestamp, string message, string? properties = null,
        string? exception = null, string level = "Information",
        string? traceId = null, string? spanId = null) =>
        new(0, timestamp, level, message, "tpl {X}", properties, exception, timestamp, traceId, spanId);

    /// <summary>Two archivable days (3 + 2 events) plus one recent event that must stay hot.</summary>
    private async Task<IReadOnlyList<Event>> SeedTwoOldDaysAndOneRecentAsync()
    {
        var seeded = new List<Event>
        {
            MakeEvent("2026-05-01T08:00:00.0000000Z", "connection refused by peer",
                """{"UserId":7,"Host":"db-1"}""", "System.Net.SocketException: boom\n   at Api.Dial()", "Error",
                traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331"),
            MakeEvent("2026-05-01T09:00:00.0000000Z", "işlem tamamlandı ✓"),
            MakeEvent("2026-05-01T23:59:59.9999999Z", "last of day one"),
            MakeEvent("2026-05-02T00:00:00.0000000Z", "first of day two", """{"OrderId":9}"""),
            MakeEvent("2026-05-02T12:00:00.0000000Z", "day two noon", null, null, "Warning"),
            MakeEvent("2026-07-12T10:00:00.0000000Z", "recent event stays hot"),
        };
        var ids = await _eventStore.WriteBatchAsync(seeded);
        return seeded.Select((item, index) => item with { Id = ids[index] }).ToList();
    }

    private async Task HydrateAsync(params string[] days)
    {
        foreach (var day in days)
        {
            Assert.True(await _archiveStore.TryBeginHydrationAsync(day));
            await _archiver.HydrateAsync(day);
        }
    }

    private static QuerySql Filter(string filter) => SqlTranslator.Translate(QueryParser.Parse(filter));

    [Fact]
    public async Task RunArchive_CompressesOldDays_DeletesHotRows_KeepsRecent()
    {
        await SeedTwoOldDaysAndOneRecentAsync();

        var created = await _archiver.RunArchiveAsync(Now);

        Assert.Equal(["2026-05-01", "2026-05-02"], created.Select(s => s.Day));
        Assert.Equal([3L, 2L], created.Select(s => s.EventCount));
        Assert.All(created, s => Assert.Equal(SegmentStatus.Cold, s.Status));
        Assert.All(created, s => Assert.True(s.SizeBytes > 0));
        Assert.All(created, s => Assert.True(s.UncompressedBytes > 0));
        Assert.True(File.Exists(Path.Combine(_archiveDir, "events-2026-05-01.jsonl.br")));
        Assert.True(File.Exists(Path.Combine(_archiveDir, "events-2026-05-02.jsonl.br")));

        Assert.Equal(1L, Scalar("SELECT COUNT(*) FROM events;"));
        Assert.Equal("recent event stays hot", Scalar("SELECT message FROM events;"));
        // the FTS index must shrink with the hot table, or deleted text stays searchable
        Assert.Equal(0L, Scalar("SELECT COUNT(*) FROM events_fts WHERE events_fts MATCH 'peer';"));
    }

    [Fact]
    public async Task RunArchive_RecordsJobDurationMetric()
    {
        await SeedTwoOldDaysAndOneRecentAsync();
        using var capture = new Telemetry.MeterCapture();

        await _archiver.RunArchiveAsync(Now);

        Assert.Contains(capture.Measurements,
            m => m.Instrument == "logharbor.archive.job.duration" && m.Value >= 0);
    }

    [Fact]
    public async Task RunArchive_SecondRun_CreatesNothing()
    {
        await SeedTwoOldDaysAndOneRecentAsync();
        await _archiver.RunArchiveAsync(Now);

        Assert.Empty(await _archiver.RunArchiveAsync(Now));
    }

    [Fact]
    public async Task RunArchive_WhenDisabled_DoesNothing()
    {
        await SeedTwoOldDaysAndOneRecentAsync();
        await _settingsStore.SaveArchiveSettingsAsync(new ArchiveSettings { CompressAfterDays = 0 });

        Assert.Empty(await _archiver.RunArchiveAsync(Now));
        Assert.Equal(6L, Scalar("SELECT COUNT(*) FROM events;"));
    }

    [Fact]
    public async Task ArchiveHydrateRoundTrip_PreservesEveryEventFieldAndId()
    {
        var seeded = await SeedTwoOldDaysAndOneRecentAsync();
        await _archiver.RunArchiveAsync(Now);
        await HydrateAsync("2026-05-01", "2026-05-02");

        var page = await _eventStore.QueryAsync(new EventQuery(null, null, null, null, 100));

        Assert.Empty(page.ArchivedDays);
        // every seeded event comes back byte-identical, hydrated and hot alike
        Assert.Equal(seeded.OrderByDescending(item => item.Id), page.Events);
    }

    [Fact]
    public async Task Query_RangeTouchingColdSegments_ListsArchivedDays()
    {
        await SeedTwoOldDaysAndOneRecentAsync();
        await _archiver.RunArchiveAsync(Now);

        var everything = await _eventStore.QueryAsync(new EventQuery(null, null, null, null, 100));
        Assert.Equal(["2026-05-01", "2026-05-02"], everything.ArchivedDays);
        Assert.Equal(["recent event stays hot"], everything.Events.Select(item => item.Message));

        var dayTwoOnly = await _eventStore.QueryAsync(new EventQuery(
            null, "2026-05-02T00:00:00.0000000Z", "2026-05-02T23:59:59.9999999Z", null, 100));
        Assert.Equal(["2026-05-02"], dayTwoOnly.ArchivedDays);

        var hotOnly = await _eventStore.QueryAsync(new EventQuery(
            null, "2026-07-01T00:00:00.0000000Z", null, null, 100));
        Assert.Empty(hotOnly.ArchivedDays);
    }

    [Fact]
    public async Task Query_FreeTextAndPropertyFilters_ReachHydratedEvents()
    {
        await SeedTwoOldDaysAndOneRecentAsync();
        await _archiver.RunArchiveAsync(Now);
        await HydrateAsync("2026-05-01", "2026-05-02");

        var freeText = await _eventStore.QueryAsync(new EventQuery(
            Filter("'connection refused'"), null, null, null, 100));
        Assert.Equal(["connection refused by peer"], freeText.Events.Select(item => item.Message));

        var byProperty = await _eventStore.QueryAsync(new EventQuery(
            Filter("OrderId = 9"), null, null, null, 100));
        Assert.Equal(["first of day two"], byProperty.Events.Select(item => item.Message));
    }

    [Fact]
    public async Task StatsAggregates_CountHotAndHydratedTogether()
    {
        await SeedTwoOldDaysAndOneRecentAsync();
        await _archiver.RunArchiveAsync(Now);
        await HydrateAsync("2026-05-01", "2026-05-02");

        var from = "2026-05-01T00:00:00.0000000Z";
        var to = "2026-07-13T00:00:00.0000000Z";

        // 3 hydrated Information events + the hot recent one share the seed template
        var errors = await _eventStore.GetTopErrorsAsync(null, from, to, ["Information"], 10);
        Assert.Equal([new TopError("tpl {X}", "Information", 4,
            "2026-05-01T09:00:00.0000000Z", "2026-07-12T10:00:00.0000000Z")], errors);

        var exceptions = await _eventStore.GetTopExceptionsAsync(null, from, to, 10);
        Assert.Equal([new TopException("System.Net.SocketException", 1,
            "2026-05-01T08:00:00.0000000Z", "2026-05-01T08:00:00.0000000Z")], exceptions);

        var values = await _eventStore.GetPropertyValuesAsync(null, from, to, "UserId", 10);
        Assert.Equal([new PropertyValueCount("7", 1)], values);
    }

    [Fact]
    public async Task Query_KeysetPaging_WalksHotAndHydratedWithoutGapsOrDuplicates()
    {
        var seeded = await SeedTwoOldDaysAndOneRecentAsync();
        await _archiver.RunArchiveAsync(Now);
        await HydrateAsync("2026-05-01", "2026-05-02");

        var collected = new List<Event>();
        long? afterId = null;
        while (true)
        {
            var page = await _eventStore.QueryAsync(new EventQuery(null, null, null, afterId, 2));
            collected.AddRange(page.Events);
            if (!page.HasMore)
            {
                break;
            }
            afterId = page.Events[^1].Id;
        }

        Assert.Equal(seeded.OrderByDescending(item => item.Id), collected);
    }

    [Fact]
    public async Task Query_TouchingHydratedSegment_RenewsLastAccessedAt()
    {
        await SeedTwoOldDaysAndOneRecentAsync();
        await _archiver.RunArchiveAsync(Now);
        await HydrateAsync("2026-05-01");
        Execute("UPDATE archive_segments SET last_accessed_at = '2026-07-01T00:00:00.0000000Z' " +
            "WHERE day = '2026-05-01';");

        await _eventStore.QueryAsync(new EventQuery(
            null, "2026-05-01T00:00:00.0000000Z", "2026-05-01T23:59:59.9999999Z", null, 10));

        var touched = (string)Scalar(
            "SELECT last_accessed_at FROM archive_segments WHERE day = '2026-05-01';");
        Assert.True(string.CompareOrdinal(touched, "2026-07-01T00:00:00.0000000Z") > 0);
    }

    [Fact]
    public async Task FindById_ReadsHydratedEventAndTouchesSegment()
    {
        var seeded = await SeedTwoOldDaysAndOneRecentAsync();
        await _archiver.RunArchiveAsync(Now);
        await HydrateAsync("2026-05-01");
        var archived = seeded.Single(item => item.Message == "connection refused by peer");

        var found = await _eventStore.FindAsync(archived.Id);

        Assert.Equal(archived, found);
    }

    [Fact]
    public async Task Find_HydratedEvent_PreservesTraceIds()
    {
        var seeded = await SeedTwoOldDaysAndOneRecentAsync();
        await _archiver.RunArchiveAsync(Now);
        await HydrateAsync("2026-05-01", "2026-05-02");

        var traced = seeded.First(item => item.TraceId is not null);
        Assert.Equal(traced, await _eventStore.FindAsync(traced.Id));
    }

    [Fact]
    public async Task Eviction_DropsStaleCache_KeepsRecentlyAccessed()
    {
        await SeedTwoOldDaysAndOneRecentAsync();
        await _archiver.RunArchiveAsync(Now);
        await HydrateAsync("2026-05-01", "2026-05-02");
        // 05-01 idle past HydrationKeepDays (1 day); 05-02 read just now
        Execute("UPDATE archive_segments SET last_accessed_at = '2026-07-11T00:00:00.0000000Z' " +
            "WHERE day = '2026-05-01';");
        Execute("UPDATE archive_segments SET last_accessed_at = '2026-07-13T11:00:00.0000000Z' " +
            "WHERE day = '2026-05-02';");

        var evicted = await _archiver.RunEvictionAsync(Now);

        Assert.Equal(["2026-05-01"], evicted);
        Assert.Equal(SegmentStatus.Cold, (await _archiveStore.FindAsync("2026-05-01"))!.Status);
        Assert.Equal(SegmentStatus.Hydrated, (await _archiveStore.FindAsync("2026-05-02"))!.Status);
        Assert.Equal(0L, Scalar("SELECT COUNT(*) FROM events_cache WHERE segment_day = '2026-05-01';"));
        Assert.Equal(2L, Scalar("SELECT COUNT(*) FROM events_cache WHERE segment_day = '2026-05-02';"));
    }

    [Fact]
    public async Task EvictedSegment_CanBeHydratedAgain_NothingLost()
    {
        var seeded = await SeedTwoOldDaysAndOneRecentAsync();
        await _archiver.RunArchiveAsync(Now);
        await HydrateAsync("2026-05-01");
        Execute("UPDATE archive_segments SET last_accessed_at = '2026-07-01T00:00:00.0000000Z';");
        await _archiver.RunEvictionAsync(Now);

        await HydrateAsync("2026-05-01");

        var page = await _eventStore.QueryAsync(new EventQuery(
            null, "2026-05-01T00:00:00.0000000Z", "2026-05-01T23:59:59.9999999Z", null, 100));
        Assert.Equal(
            seeded.Where(item => item.Timestamp.StartsWith("2026-05-01")).OrderByDescending(item => item.Id),
            page.Events);
    }

    [Fact]
    public async Task Retention_DeletesExpiredSegmentsRowsAndFiles()
    {
        await SeedTwoOldDaysAndOneRecentAsync();
        await _archiver.RunArchiveAsync(Now);
        await _settingsStore.SaveArchiveSettingsAsync(
            new ArchiveSettings { CompressAfterDays = 30, HydrationKeepDays = 1, RetentionDays = 72 });
        // 2026-05-01 is 73 days before Now, 2026-05-02 is 72 (within retention)

        var removed = await _archiver.RunRetentionAsync(Now);

        Assert.Equal(1, removed);
        Assert.Null(await _archiveStore.FindAsync("2026-05-01"));
        Assert.False(File.Exists(Path.Combine(_archiveDir, "events-2026-05-01.jsonl.br")));
        Assert.NotNull(await _archiveStore.FindAsync("2026-05-02"));
        Assert.True(File.Exists(Path.Combine(_archiveDir, "events-2026-05-02.jsonl.br")));
    }

    [Fact]
    public async Task Retention_WithArchivingDisabled_DeletesOldHotRowsDirectly()
    {
        await SeedTwoOldDaysAndOneRecentAsync();
        await _settingsStore.SaveArchiveSettingsAsync(
            new ArchiveSettings { CompressAfterDays = 0, RetentionDays = 30 });

        var removed = await _archiver.RunRetentionAsync(Now);

        Assert.Equal(5, removed);
        Assert.Equal("recent event stays hot", Scalar("SELECT message FROM events;"));
    }

    public void Dispose()
    {
        _db.ClearPool();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            File.Delete(_dbPath + suffix);
        }
        if (Directory.Exists(_archiveDir))
        {
            Directory.Delete(_archiveDir, recursive: true);
        }
    }

    private object Scalar(string sql)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return command.ExecuteScalar()!;
    }

    private void Execute(string sql)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }
}
