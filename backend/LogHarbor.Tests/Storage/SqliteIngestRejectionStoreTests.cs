using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Storage;

public sealed class SqliteIngestRejectionStoreTests : IDisposable
{
    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"logharbor-test-{Guid.NewGuid():N}.db");

    private readonly LogHarborDb _db;
    private readonly SqliteIngestRejectionStore _store;

    private static readonly DateTimeOffset Monday =
        new(2026, 7, 13, 9, 0, 0, TimeSpan.Zero);

    public SqliteIngestRejectionStoreTests()
    {
        _db = new LogHarborDb(_dbPath);
        MigrationRunner.Apply(_db, Path.Combine(AppContext.BaseDirectory, "Migrations"));
        _store = new SqliteIngestRejectionStore(_db);
    }

    public void Dispose()
    {
        _db.ClearPool();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            File.Delete(_dbPath + suffix);
        }
    }

    [Fact]
    public async Task RecordsOneBucketPerKeyReasonAndDay()
    {
        await _store.RecordAsync(1, RejectionReasons.InvalidPayload, "line 1: bad", Monday);
        await _store.RecordAsync(1, RejectionReasons.InvalidPayload, "line 4: worse", Monday.AddMinutes(5));
        await _store.RecordAsync(1, RejectionReasons.RateLimited, "too fast", Monday);
        await _store.RecordAsync(2, RejectionReasons.InvalidPayload, "line 1: bad", Monday);

        var rejections = await _store.ListAsync(days: 3650);

        Assert.Equal(3, rejections.Count);
        var repeated = rejections.Single(r =>
            r.ApiKeyId == 1 && r.Reason == RejectionReasons.InvalidPayload);
        Assert.Equal(2, repeated.RequestCount);
    }

    [Fact]
    public async Task RepeatedRejection_KeepsFirstSeen_AndMovesLastSeenAndDetail()
    {
        await _store.RecordAsync(1, RejectionReasons.InvalidPayload, "the first one", Monday);
        await _store.RecordAsync(1, RejectionReasons.InvalidPayload, "the latest one", Monday.AddHours(2));

        var rejection = (await _store.ListAsync(days: 3650)).Single();

        Assert.Equal("2026-07-13T09:00:00.0000000Z", rejection.FirstSeen);
        Assert.Equal("2026-07-13T11:00:00.0000000Z", rejection.LastSeen);
        Assert.Equal("the latest one", rejection.LastDetail);
        Assert.Equal("2026-07-13", rejection.Day);
    }

    [Fact]
    public async Task SameKeyAndReason_OnAnotherDay_IsItsOwnBucket()
    {
        await _store.RecordAsync(1, RejectionReasons.TooLarge, "big", Monday);
        await _store.RecordAsync(1, RejectionReasons.TooLarge, "big", Monday.AddDays(1));

        Assert.Equal(2, (await _store.ListAsync(days: 3650)).Count);
    }

    [Fact]
    public async Task ListResolvesTheKeyTitle_AndLeavesItNullForUnauthenticated()
    {
        var key = await new SqliteApiKeyStore(_db).CreateAsync("shipping-service");
        await _store.RecordAsync(key.Id, RejectionReasons.InvalidPayload, "bad", Monday);
        await _store.RecordAsync(0, RejectionReasons.Unauthorized, "no API key header", Monday);

        var rejections = await _store.ListAsync(days: 3650);

        Assert.Equal("shipping-service",
            rejections.Single(r => r.ApiKeyId == key.Id).ApiKeyTitle);
        Assert.Null(rejections.Single(r => r.ApiKeyId == 0).ApiKeyTitle);
    }

    [Fact]
    public async Task ListWindow_ExcludesOlderDays()
    {
        await _store.RecordAsync(1, RejectionReasons.TooLarge, "old", DateTimeOffset.UtcNow.AddDays(-10));
        await _store.RecordAsync(1, RejectionReasons.TooLarge, "recent", DateTimeOffset.UtcNow);

        var rejections = await _store.ListAsync(days: 3);

        Assert.Equal("recent", rejections.Single().LastDetail);
    }

    [Fact]
    public async Task Prune_DropsBucketsPastTheKeepWindow()
    {
        await _store.RecordAsync(1, RejectionReasons.TooLarge, "ancient", DateTimeOffset.UtcNow.AddDays(-40));
        await _store.RecordAsync(1, RejectionReasons.TooLarge, "today", DateTimeOffset.UtcNow);

        var removed = await _store.PruneAsync(keepDays: 30);

        Assert.Equal(1, removed);
        Assert.Equal("today", (await _store.ListAsync(days: 30)).Single().LastDetail);
    }

    /// <summary>A parse error quotes the client's own line, so the stored detail is capped.</summary>
    [Fact]
    public async Task OverlongDetail_IsTruncated()
    {
        await _store.RecordAsync(1, RejectionReasons.InvalidPayload, new string('x', 5000), Monday);

        var rejection = (await _store.ListAsync(days: 3650)).Single();

        Assert.Equal(200, rejection.LastDetail!.Length);
    }
}
