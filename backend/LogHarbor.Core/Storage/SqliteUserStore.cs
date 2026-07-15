using Microsoft.Data.Sqlite;
using LogHarbor.Core.Auth;
using LogHarbor.Core.Events;

namespace LogHarbor.Core.Storage;

public sealed class SqliteUserStore : IUserStore
{
    private const string Columns = "id, username, role, created_at, must_change_password";
    private const int SqliteConstraintErrorCode = 19;

    // verified against when the username does not exist, so a miss costs the same
    // PBKDF2 work as a hit and usernames cannot be enumerated by timing
    private static readonly PasswordHasher.HashedPassword DecoyPassword = PasswordHasher.Hash(Guid.NewGuid().ToString());

    private readonly LogHarborDb _db;

    public SqliteUserStore(LogHarborDb db) => _db = db;

    public async Task<User> CreateAsync(
        string username,
        string password,
        string role,
        bool mustChangePassword = false,
        CancellationToken cancellationToken = default)
    {
        var hashed = PasswordHasher.Hash(password);
        var createdAt = ClefParser.FormatTimestamp(DateTimeOffset.UtcNow);

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO users (username, password_salt, password_hash, role, created_at, must_change_password) " +
            "VALUES (@username, @salt, @hash, @role, @createdAt, @mustChange); " +
            "SELECT last_insert_rowid();";
        command.Parameters.AddWithValue("@username", username);
        command.Parameters.AddWithValue("@salt", Convert.ToBase64String(hashed.Salt));
        command.Parameters.AddWithValue("@hash", Convert.ToBase64String(hashed.Hash));
        command.Parameters.AddWithValue("@role", role);
        command.Parameters.AddWithValue("@createdAt", createdAt);
        command.Parameters.AddWithValue("@mustChange", mustChangePassword ? 1 : 0);

        long id;
        try
        {
            id = (long)(await command.ExecuteScalarAsync(cancellationToken))!;
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == SqliteConstraintErrorCode)
        {
            throw new DuplicateUsernameException(username);
        }
        return new User(id, username, role, createdAt, mustChangePassword);
    }

    public async Task<bool> SetPasswordAsync(
        long id, string password, CancellationToken cancellationToken = default)
    {
        var hashed = PasswordHasher.Hash(password);

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE users SET password_salt = @salt, password_hash = @hash, must_change_password = 0 " +
            "WHERE id = @id;";
        command.Parameters.AddWithValue("@salt", Convert.ToBase64String(hashed.Salt));
        command.Parameters.AddWithValue("@hash", Convert.ToBase64String(hashed.Hash));
        command.Parameters.AddWithValue("@id", id);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    public async Task<IReadOnlyList<User>> ListAsync(CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {Columns} FROM users ORDER BY username;";

        var users = new List<User>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            users.Add(ReadUser(reader));
        }
        return users;
    }

    public async Task<User?> FindAsync(long id, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {Columns} FROM users WHERE id = @id;";
        command.Parameters.AddWithValue("@id", id);

        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadUser(reader) : null;
    }

    public async Task<bool> DeleteAsync(long id, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM users WHERE id = @id;";
        command.Parameters.AddWithValue("@id", id);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    public async Task<User?> AuthenticateAsync(
        string username, string password, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            $"SELECT {Columns}, password_salt, password_hash FROM users WHERE username = @username;";
        command.Parameters.AddWithValue("@username", username);

        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            PasswordHasher.Verify(password, DecoyPassword);
            return null;
        }

        var stored = new PasswordHasher.HashedPassword(
            Convert.FromBase64String(reader.GetString(5)),
            Convert.FromBase64String(reader.GetString(6)));
        return PasswordHasher.Verify(password, stored) ? ReadUser(reader) : null;
    }

    public async Task<long> CountAsync(CancellationToken cancellationToken = default)
    {
        return await ScalarAsync("SELECT COUNT(*) FROM users;", cancellationToken);
    }

    public async Task<long> CountAdminsAsync(CancellationToken cancellationToken = default)
    {
        return await ScalarAsync($"SELECT COUNT(*) FROM users WHERE role = '{UserRole.Admin}';", cancellationToken);
    }

    private async Task<long> ScalarAsync(string sql, CancellationToken cancellationToken)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return (long)(await command.ExecuteScalarAsync(cancellationToken))!;
    }

    private static User ReadUser(SqliteDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.GetString(2),
        reader.GetString(3),
        reader.GetInt64(4) != 0);
}
