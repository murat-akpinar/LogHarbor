using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Storage;

public sealed class SqliteDatabaseSizeStoreTests : IDisposable
{
    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"logharbor-test-{Guid.NewGuid():N}.db");

    private readonly LogHarborDb _db;
    private readonly SqliteDatabaseSizeStore _store;

    private static readonly DateTimeOffset Noon = new(2026, 7, 20, 12, 0, 0, TimeSpan.Zero);

    public SqliteDatabaseSizeStoreTests()
    {
        _db = new LogHarborDb(_dbPath);
        MigrationRunner.Apply(_db, Path.Combine(AppContext.BaseDirectory, "Migrations"));
        _store = new SqliteDatabaseSizeStore(_db);
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
    public async Task ListSince_ReturnsReadingsOldestFirst()
    {
        await _store.RecordAsync(300, Noon.AddHours(2));
        await _store.RecordAsync(100, Noon);
        await _store.RecordAsync(200, Noon.AddHours(1));

        var samples = await _store.ListSinceAsync(Noon.AddHours(-1));

        Assert.Equal(new long[] { 100, 200, 300 }, samples.Select(sample => sample.SizeBytes));
    }

    [Fact]
    public async Task ListSince_ExcludesReadingsBeforeTheWindow()
    {
        await _store.RecordAsync(100, Noon.AddDays(-8));
        await _store.RecordAsync(200, Noon);

        var samples = await _store.ListSinceAsync(Noon.AddDays(-7));

        Assert.Equal(200, Assert.Single(samples).SizeBytes);
    }

    [Fact]
    public async Task Record_AtTheSameInstant_OverwritesRatherThanDuplicates()
    {
        await _store.RecordAsync(100, Noon);
        await _store.RecordAsync(150, Noon);

        var samples = await _store.ListSinceAsync(Noon.AddHours(-1));

        Assert.Equal(150, Assert.Single(samples).SizeBytes);
    }

    [Fact]
    public async Task Prune_DropsOnlyReadingsOlderThanTheWindow()
    {
        var now = DateTimeOffset.UtcNow;
        await _store.RecordAsync(100, now.AddDays(-20));
        await _store.RecordAsync(200, now.AddDays(-1));

        var removed = await _store.PruneAsync(14);

        Assert.Equal(1, removed);
        Assert.Equal(200, Assert.Single(await _store.ListSinceAsync(now.AddDays(-30))).SizeBytes);
    }
}
