using Microsoft.Data.Sqlite;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Storage;

public sealed class SqliteSignalStoreTests : IDisposable
{
    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"logharbor-test-{Guid.NewGuid():N}.db");

    private readonly LogHarborDb _db;
    private readonly SqliteSignalStore _store;

    public SqliteSignalStoreTests()
    {
        _db = new LogHarborDb(_dbPath);
        MigrationRunner.Apply(_db, Path.Combine(AppContext.BaseDirectory, "Migrations"));
        _store = new SqliteSignalStore(_db);
    }

    [Fact]
    public async Task Create_PersistsAndReturnsSignal()
    {
        var created = await _store.CreateAsync("Errors", "@Level = 'Error'");

        Assert.True(created.Id > 0);
        Assert.Equal("Errors", created.Title);
        Assert.Equal("@Level = 'Error'", created.Filter);
        Assert.NotEmpty(created.CreatedAt);
    }

    [Fact]
    public async Task Create_DuplicateTitle_Throws()
    {
        await _store.CreateAsync("Errors", "@Level = 'Error'");

        await Assert.ThrowsAsync<DuplicateSignalTitleException>(
            () => _store.CreateAsync("Errors", "@Level = 'Fatal'"));
    }

    [Fact]
    public async Task List_ReturnsSignalsOrderedByTitle()
    {
        await _store.CreateAsync("Zulu", "A = 1");
        await _store.CreateAsync("Alpha", "B = 2");

        var signals = await _store.ListAsync();

        Assert.Equal(["Alpha", "Zulu"], signals.Select(s => s.Title));
    }

    [Fact]
    public async Task Update_ExistingSignal_ChangesTitleAndFilter()
    {
        var created = await _store.CreateAsync("Errors", "@Level = 'Error'");

        var updated = await _store.UpdateAsync(created.Id, "Errors renamed", "@Level = 'Fatal'");

        Assert.NotNull(updated);
        Assert.Equal("Errors renamed", updated.Title);
        Assert.Equal("@Level = 'Fatal'", updated.Filter);
    }

    [Fact]
    public async Task Update_UnknownId_ReturnsNull()
    {
        Assert.Null(await _store.UpdateAsync(999, "x", "A = 1"));
    }

    [Fact]
    public async Task Update_ToTitleUsedByAnotherSignal_Throws()
    {
        await _store.CreateAsync("Errors", "@Level = 'Error'");
        var other = await _store.CreateAsync("Warnings", "@Level = 'Warning'");

        await Assert.ThrowsAsync<DuplicateSignalTitleException>(
            () => _store.UpdateAsync(other.Id, "Errors", "@Level = 'Warning'"));
    }

    [Fact]
    public async Task Delete_ExistingSignal_ReturnsTrueAndRemovesIt()
    {
        var created = await _store.CreateAsync("Errors", "@Level = 'Error'");

        Assert.True(await _store.DeleteAsync(created.Id));
        Assert.Empty(await _store.ListAsync());
    }

    [Fact]
    public async Task Delete_UnknownId_ReturnsFalse()
    {
        Assert.False(await _store.DeleteAsync(999));
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
