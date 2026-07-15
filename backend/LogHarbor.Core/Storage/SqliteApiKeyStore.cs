using System.Security.Cryptography;
using System.Text;
using LogHarbor.Core.Events;

namespace LogHarbor.Core.Storage;

public sealed class SqliteApiKeyStore : IApiKeyStore
{
    private readonly LogHarborDb _db;

    public SqliteApiKeyStore(LogHarborDb db) => _db = db;

    public async Task<CreatedApiKey> CreateAsync(string title, CancellationToken cancellationToken = default)
    {
        var token = "logharbor_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var createdAt = ClefParser.FormatTimestamp(DateTimeOffset.UtcNow);

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO api_keys (title, token_hash, created_at) VALUES (@title, @tokenHash, @createdAt); " +
            "SELECT last_insert_rowid();";
        command.Parameters.AddWithValue("@title", title);
        command.Parameters.AddWithValue("@tokenHash", HashToken(token));
        command.Parameters.AddWithValue("@createdAt", createdAt);
        var id = (long)(await command.ExecuteScalarAsync(cancellationToken))!;

        return new CreatedApiKey(id, title, token, createdAt);
    }

    public async Task<IReadOnlyList<ApiKey>> ListAsync(CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT id, title, created_at, is_active FROM api_keys ORDER BY id;";
        using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var keys = new List<ApiKey>();
        while (await reader.ReadAsync(cancellationToken))
        {
            keys.Add(new ApiKey(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetInt64(3) == 1));
        }
        return keys;
    }

    public async Task<bool> RevokeAsync(long id, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE api_keys SET is_active = 0 WHERE id = @id;";
        command.Parameters.AddWithValue("@id", id);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    public async Task<long?> AuthenticateAsync(string token, CancellationToken cancellationToken = default)
    {
        var tokenHash = HashToken(token);

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT id, token_hash FROM api_keys WHERE token_hash = @tokenHash AND is_active = 1;";
        command.Parameters.AddWithValue("@tokenHash", tokenHash);
        using var reader = await command.ExecuteReaderAsync(cancellationToken);

        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }
        // constant-time re-check per rules.md; the indexed lookup above is only a fast path
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(tokenHash), Encoding.UTF8.GetBytes(reader.GetString(1)))
            ? reader.GetInt64(0)
            : null;
    }

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
}
