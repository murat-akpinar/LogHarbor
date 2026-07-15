using Microsoft.Data.Sqlite;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Storage;

public sealed class SqliteApiKeyStoreTests : IDisposable
{
    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"logharbor-test-{Guid.NewGuid():N}.db");

    private readonly LogHarborDb _db;
    private readonly SqliteApiKeyStore _store;

    public SqliteApiKeyStoreTests()
    {
        _db = new LogHarborDb(_dbPath);
        MigrationRunner.Apply(_db, Path.Combine(AppContext.BaseDirectory, "Migrations"));
        _store = new SqliteApiKeyStore(_db);
    }

    [Fact]
    public async Task Create_ReturnsTokenOnce_AndStoresOnlyItsHash()
    {
        var created = await _store.CreateAsync("OrderService");

        Assert.StartsWith("logharbor_", created.Token);
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT token_hash FROM api_keys WHERE id = @id;";
        command.Parameters.AddWithValue("@id", created.Id);
        var storedHash = (string)command.ExecuteScalar()!;
        Assert.NotEqual(created.Token, storedHash);
        Assert.Equal(64, storedHash.Length); // SHA-256 hex
    }

    [Fact]
    public async Task List_ReturnsKeysWithoutTokens()
    {
        await _store.CreateAsync("first");
        await _store.CreateAsync("second");

        var keys = await _store.ListAsync();

        Assert.Equal(["first", "second"], keys.Select(k => k.Title));
        Assert.All(keys, k => Assert.True(k.IsActive));
    }

    [Fact]
    public async Task Authenticate_ValidToken_ReturnsKeyId()
    {
        var created = await _store.CreateAsync("svc");

        Assert.Equal(created.Id, await _store.AuthenticateAsync(created.Token));
    }

    [Fact]
    public async Task Authenticate_UnknownToken_ReturnsNull()
    {
        await _store.CreateAsync("svc");

        Assert.Null(await _store.AuthenticateAsync("logharbor_wrong"));
    }

    [Fact]
    public async Task Authenticate_RevokedKey_ReturnsNull()
    {
        var created = await _store.CreateAsync("svc");

        Assert.True(await _store.RevokeAsync(created.Id));

        Assert.Null(await _store.AuthenticateAsync(created.Token));
        var key = (await _store.ListAsync()).Single();
        Assert.False(key.IsActive);
    }

    [Fact]
    public async Task Revoke_UnknownId_ReturnsFalse()
    {
        Assert.False(await _store.RevokeAsync(999));
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
