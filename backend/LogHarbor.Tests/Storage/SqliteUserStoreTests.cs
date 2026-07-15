using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Storage;

public sealed class SqliteUserStoreTests : IDisposable
{
    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"logharbor-test-{Guid.NewGuid():N}.db");

    private readonly LogHarborDb _db;
    private readonly SqliteUserStore _store;

    public SqliteUserStoreTests()
    {
        _db = new LogHarborDb(_dbPath);
        MigrationRunner.Apply(_db, Path.Combine(AppContext.BaseDirectory, "Migrations"));
        _store = new SqliteUserStore(_db);
    }

    [Fact]
    public async Task Create_List_Delete_RoundTrip()
    {
        var created = await _store.CreateAsync("alice", "password123", UserRole.Admin);
        await _store.CreateAsync("bob", "password456", UserRole.Viewer);

        Assert.Equal(["alice", "bob"], (await _store.ListAsync()).Select(user => user.Username));
        Assert.Equal(2, await _store.CountAsync());
        Assert.Equal(1, await _store.CountAdminsAsync());
        Assert.Equal(created, await _store.FindAsync(created.Id));

        Assert.True(await _store.DeleteAsync(created.Id));
        Assert.False(await _store.DeleteAsync(created.Id));
        Assert.Equal(1, await _store.CountAsync());
    }

    [Fact]
    public async Task Create_DuplicateUsername_IsCaseInsensitive()
    {
        await _store.CreateAsync("Alice", "password123", UserRole.Admin);

        await Assert.ThrowsAsync<DuplicateUsernameException>(() =>
            _store.CreateAsync("alice", "other-password", UserRole.Viewer));
    }

    [Fact]
    public async Task Authenticate_ChecksPasswordAndIgnoresUsernameCase()
    {
        await _store.CreateAsync("alice", "password123", UserRole.Viewer);

        var byExact = await _store.AuthenticateAsync("alice", "password123");
        Assert.Equal(UserRole.Viewer, byExact!.Role);
        Assert.NotNull(await _store.AuthenticateAsync("ALICE", "password123"));
        Assert.Null(await _store.AuthenticateAsync("alice", "wrong"));
        Assert.Null(await _store.AuthenticateAsync("nobody", "password123"));
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
