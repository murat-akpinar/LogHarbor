using Microsoft.Data.Sqlite;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Storage;

public sealed class SqliteArchiveStoreTests : IDisposable
{
    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"logharbor-test-{Guid.NewGuid():N}.db");

    private readonly LogHarborDb _db;
    private readonly SqliteArchiveStore _store;
    private readonly SqliteEventStore _eventStore;

    public SqliteArchiveStoreTests()
    {
        _db = new LogHarborDb(_dbPath);
        MigrationRunner.Apply(_db, Path.Combine(AppContext.BaseDirectory, "Migrations"));
        _store = new SqliteArchiveStore(_db);
        _eventStore = new SqliteEventStore(_db);
    }

    private static Event MakeEvent(string timestamp, string message = "hello") =>
        new(0, timestamp, "Information", message, null, null, null, timestamp);

    private static ArchiveSegment MakeSegment(string day, long eventCount = 1) =>
        new(day, $"events-{day}.jsonl.br", eventCount, 100, 1000, SegmentStatus.Cold, null, null);

    private async Task<ArchiveSegment> SeedSegmentAsync(string day, int eventCount = 1)
    {
        var events = Enumerable.Range(0, eventCount)
            .Select(i => MakeEvent($"{day}T10:00:0{i}.0000000Z", $"event {i} of {day}"))
            .ToList();
        var ids = await _eventStore.WriteBatchAsync(events);
        var segment = MakeSegment(day, eventCount);
        await _store.CommitSegmentAsync(segment, ids[^1]);
        return segment;
    }

    [Fact]
    public async Task CommitSegment_RecordsSegmentAndDeletesHotRows()
    {
        await _eventStore.WriteBatchAsync([MakeEvent("2026-05-02T00:00:00.0000000Z", "next day")]);
        await SeedSegmentAsync("2026-05-01", eventCount: 2);

        var segment = await _store.FindAsync("2026-05-01");
        Assert.NotNull(segment);
        Assert.Equal(2, segment.EventCount);
        Assert.Equal(SegmentStatus.Cold, segment.Status);

        // only the archived day's rows are gone; the neighbouring day's row stays
        Assert.Equal(1L, Scalar("SELECT COUNT(*) FROM events;"));
        Assert.Equal("next day", Scalar("SELECT message FROM events;"));
    }

    [Fact]
    public async Task CommitSegment_CountMismatch_RollsBackAndKeepsHotRows()
    {
        var ids = await _eventStore.WriteBatchAsync([MakeEvent("2026-05-01T10:00:00.0000000Z")]);

        await Assert.ThrowsAsync<ArchiveVerificationException>(() =>
            _store.CommitSegmentAsync(MakeSegment("2026-05-01", eventCount: 5), ids[^1]));

        Assert.Equal(1L, Scalar("SELECT COUNT(*) FROM events;"));
        Assert.Equal(0L, Scalar("SELECT COUNT(*) FROM archive_segments;"));
    }

    [Fact]
    public async Task CommitSegment_LateArrivalsAboveMaxId_AreKept()
    {
        var ids = await _eventStore.WriteBatchAsync([MakeEvent("2026-05-01T10:00:00.0000000Z", "exported")]);
        // arrives after the export snapshot but before the delete: higher id, same day
        await _eventStore.WriteBatchAsync([MakeEvent("2026-05-01T11:00:00.0000000Z", "late arrival")]);

        await _store.CommitSegmentAsync(MakeSegment("2026-05-01", eventCount: 1), ids[^1]);

        Assert.Equal("late arrival", Scalar("SELECT message FROM events;"));
    }

    [Fact]
    public async Task List_ReturnsNewestDayFirst_AndRangeFiltersInclusive()
    {
        await SeedSegmentAsync("2026-05-01");
        await SeedSegmentAsync("2026-05-03");
        await SeedSegmentAsync("2026-05-05");

        Assert.Equal(["2026-05-05", "2026-05-03", "2026-05-01"],
            (await _store.ListAsync()).Select(s => s.Day));
        Assert.Equal(["2026-05-01", "2026-05-03"],
            (await _store.ListRangeAsync("2026-05-01", "2026-05-03")).Select(s => s.Day));
        Assert.Equal(["2026-05-03", "2026-05-05"],
            (await _store.ListRangeAsync("2026-05-02", null)).Select(s => s.Day));
        Assert.Equal(3, (await _store.ListRangeAsync(null, null)).Count);
    }

    [Fact]
    public async Task GetArchivableDays_ExcludesCutoffAndAlreadyArchivedDays()
    {
        await SeedSegmentAsync("2026-05-01");
        await _eventStore.WriteBatchAsync(
        [
            MakeEvent("2026-05-01T23:00:00.0000000Z", "late for archived day"),
            MakeEvent("2026-05-02T10:00:00.0000000Z"),
            MakeEvent("2026-06-01T10:00:00.0000000Z"),
        ]);

        var days = await _store.GetArchivableDaysAsync("2026-06-01");

        // 2026-05-01 already has a segment, 2026-06-01 is not strictly before the cutoff
        Assert.Equal(["2026-05-02"], days);
    }

    [Fact]
    public async Task TryBeginHydration_ClaimsColdOnlyOnce()
    {
        await SeedSegmentAsync("2026-05-01");

        Assert.True(await _store.TryBeginHydrationAsync("2026-05-01"));
        Assert.False(await _store.TryBeginHydrationAsync("2026-05-01"));
        Assert.Equal(SegmentStatus.Hydrating, (await _store.FindAsync("2026-05-01"))!.Status);
    }

    [Fact]
    public async Task CompleteHydration_InsertsCacheRowsWithOriginalIds_AndFtsWorks()
    {
        await SeedSegmentAsync("2026-05-01", eventCount: 2);
        Assert.True(await _store.TryBeginHydrationAsync("2026-05-01"));

        var archived = new List<Event>
        {
            new(1, "2026-05-01T10:00:00.0000000Z", "Error", "connection refused by peer",
                "tpl", """{"UserId":7}""", "boom", "2026-05-01T10:00:01.0000000Z"),
            new(2, "2026-05-01T10:00:01.0000000Z", "Information", "ok", null, null, null,
                "2026-05-01T10:00:02.0000000Z"),
        };
        await _store.CompleteHydrationAsync("2026-05-01", archived, "2026-07-13T12:00:00.0000000Z");

        var segment = (await _store.FindAsync("2026-05-01"))!;
        Assert.Equal(SegmentStatus.Hydrated, segment.Status);
        Assert.Equal("2026-07-13T12:00:00.0000000Z", segment.HydratedAt);
        Assert.Equal("2026-07-13T12:00:00.0000000Z", segment.LastAccessedAt);
        Assert.Equal(2L, Scalar("SELECT COUNT(*) FROM events_cache WHERE segment_day = '2026-05-01';"));
        Assert.Equal(1L, Scalar("SELECT id FROM events_cache WHERE message = 'connection refused by peer';"));
        Assert.Equal(1L, Scalar(
            "SELECT COUNT(*) FROM events_cache_fts WHERE events_cache_fts MATCH '\"connection refused\"';"));
    }

    [Fact]
    public async Task Evict_ClearsCacheAndFts_ReturnsSegmentToCold()
    {
        await SeedSegmentAsync("2026-05-01");
        Assert.True(await _store.TryBeginHydrationAsync("2026-05-01"));
        await _store.CompleteHydrationAsync("2026-05-01",
            [new Event(1, "2026-05-01T10:00:00.0000000Z", "Error", "connection refused", null, null, null,
                "2026-05-01T10:00:01.0000000Z")],
            "2026-07-12T12:00:00.0000000Z");

        await _store.EvictAsync("2026-05-01");

        var segment = (await _store.FindAsync("2026-05-01"))!;
        Assert.Equal(SegmentStatus.Cold, segment.Status);
        Assert.Null(segment.HydratedAt);
        Assert.Null(segment.LastAccessedAt);
        Assert.Equal(0L, Scalar("SELECT COUNT(*) FROM events_cache;"));
        Assert.Equal(0L, Scalar(
            "SELECT COUNT(*) FROM events_cache_fts WHERE events_cache_fts MATCH 'connection';"));
    }

    [Fact]
    public async Task GetEvictableDays_ReturnsOnlyStaleHydratedSegments()
    {
        await SeedSegmentAsync("2026-05-01");
        await SeedSegmentAsync("2026-05-02");
        await SeedSegmentAsync("2026-05-03");
        foreach (var day in new[] { "2026-05-01", "2026-05-02" })
        {
            Assert.True(await _store.TryBeginHydrationAsync(day));
        }
        await _store.CompleteHydrationAsync("2026-05-01", [], "2026-07-10T12:00:00.0000000Z");
        await _store.CompleteHydrationAsync("2026-05-02", [], "2026-07-13T11:00:00.0000000Z");

        var evictable = await _store.GetEvictableDaysAsync("2026-07-12T12:00:00.0000000Z");

        Assert.Equal(["2026-05-01"], evictable);
    }

    [Fact]
    public async Task ResetInterruptedHydrations_ReturnsHydratingSegmentsToCold()
    {
        await SeedSegmentAsync("2026-05-01");
        await SeedSegmentAsync("2026-05-02");
        Assert.True(await _store.TryBeginHydrationAsync("2026-05-01"));

        var reset = await _store.ResetInterruptedHydrationsAsync();

        Assert.Equal(["2026-05-01"], reset);
        Assert.Equal(SegmentStatus.Cold, (await _store.FindAsync("2026-05-01"))!.Status);
        Assert.Equal(SegmentStatus.Cold, (await _store.FindAsync("2026-05-02"))!.Status);
    }

    [Fact]
    public async Task DeleteSegment_RemovesRowAndCacheRows()
    {
        await SeedSegmentAsync("2026-05-01");
        Assert.True(await _store.TryBeginHydrationAsync("2026-05-01"));
        await _store.CompleteHydrationAsync("2026-05-01",
            [new Event(1, "2026-05-01T10:00:00.0000000Z", "Information", "old", null, null, null,
                "2026-05-01T10:00:01.0000000Z")],
            "2026-07-13T12:00:00.0000000Z");

        await _store.DeleteSegmentAsync("2026-05-01");

        Assert.Null(await _store.FindAsync("2026-05-01"));
        Assert.Equal(0L, Scalar("SELECT COUNT(*) FROM events_cache;"));
    }

    [Fact]
    public async Task DeleteHotEventsBefore_DeletesOnlyOlderRows()
    {
        await _eventStore.WriteBatchAsync(
        [
            MakeEvent("2026-05-01T10:00:00.0000000Z", "old"),
            MakeEvent("2026-07-12T10:00:00.0000000Z", "recent"),
        ]);

        var deleted = await _store.DeleteHotEventsBeforeAsync("2026-06-01T00:00:00.0000000Z");

        Assert.Equal(1, deleted);
        Assert.Equal("recent", Scalar("SELECT message FROM events;"));
    }

    public void Dispose()
    {
        _db.ClearPool();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            File.Delete(_dbPath + suffix);
        }
    }

    private object Scalar(string sql)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return command.ExecuteScalar()!;
    }
}
