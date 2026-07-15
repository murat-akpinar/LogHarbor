using Microsoft.Data.Sqlite;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Storage;

public sealed class SqliteSettingsStoreTests : IDisposable
{
    private static readonly ArchiveSettings Defaults =
        new() { CompressAfterDays = 30, HydrationKeepDays = 2, RetentionDays = 100 };

    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"logharbor-test-{Guid.NewGuid():N}.db");

    private readonly LogHarborDb _db;
    private readonly SqliteSettingsStore _store;

    public SqliteSettingsStoreTests()
    {
        _db = new LogHarborDb(_dbPath);
        MigrationRunner.Apply(_db, Path.Combine(AppContext.BaseDirectory, "Migrations"));
        _store = new SqliteSettingsStore(_db, Defaults);
    }

    [Fact]
    public async Task Get_WhenNeverSaved_ReturnsDefaults()
    {
        Assert.Equal(Defaults, await _store.GetArchiveSettingsAsync());
    }

    [Fact]
    public async Task SaveThenGet_RoundTrips()
    {
        var saved = new ArchiveSettings { CompressAfterDays = 7, HydrationKeepDays = 3, RetentionDays = 30 };

        await _store.SaveArchiveSettingsAsync(saved);

        Assert.Equal(saved, await _store.GetArchiveSettingsAsync());
    }

    [Fact]
    public async Task Save_Twice_OverwritesPreviousValue()
    {
        await _store.SaveArchiveSettingsAsync(new ArchiveSettings { CompressAfterDays = 7 });
        var second = new ArchiveSettings { CompressAfterDays = 0, HydrationKeepDays = 5, RetentionDays = 10 };

        await _store.SaveArchiveSettingsAsync(second);

        var loaded = await _store.GetArchiveSettingsAsync();
        Assert.Equal(second, loaded);
        Assert.False(loaded.ArchivingEnabled);
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
