using Microsoft.Data.Sqlite;
using LogHarbor.Core.Auth;
using LogHarbor.Core.Events;

namespace LogHarbor.Core.Storage;

public sealed class SqliteUserStore : IUserStore
{
    private const string Columns = "id, username, role, created_at, must_change_password, last_login_at";
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
            Convert.FromBase64String(reader.GetString(6)),
            Convert.FromBase64String(reader.GetString(7)));
        return PasswordHasher.Verify(password, stored) ? ReadUser(reader) : null;
    }

    public async Task<long> CountAsync(CancellationToken cancellationToken = default)
    {
        return await ScalarAsync("SELECT COUNT(*) FROM users;", cancellationToken);
    }

    public async Task<long> CountAdminsAsync(CancellationToken cancellationToken = default)
    {
        // bound, not interpolated: UserRole.Admin is a compile-time constant so nothing was
        // injectable, but rules.md SECURITY says parameterized only and one exception is how
        // the habit erodes
        return await ScalarAsync(
            "SELECT COUNT(*) FROM users WHERE role = @role;", cancellationToken,
            ("@role", UserRole.Admin));
    }

    private async Task<long> ScalarAsync(
        string sql, CancellationToken cancellationToken, params (string Name, object Value)[] parameters)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }
        return (long)(await command.ExecuteScalarAsync(cancellationToken))!;
    }

    private static User ReadUser(SqliteDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.GetString(2),
        reader.GetString(3),
        reader.GetInt64(4) != 0,
        reader.IsDBNull(5) ? null : reader.GetString(5));

    public async Task RecordLoginAsync(long id, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE users SET last_login_at = @at WHERE id = @id;";
        command.Parameters.AddWithValue("@at", ClefParser.FormatTimestamp(DateTimeOffset.UtcNow));
        command.Parameters.AddWithValue("@id", id);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task RecordDirectoryLoginAsync(
        string username, string role, CancellationToken cancellationToken = default)
    {
        var at = ClefParser.FormatTimestamp(DateTimeOffset.UtcNow);

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        // first_seen_at is left alone by the update: "since when has this person been coming in"
        // is the one thing the row knows that a fresh sign-in cannot say
        command.CommandText =
            "INSERT INTO directory_users (username, last_role, first_seen_at, last_login_at) " +
            "VALUES (@username, @role, @at, @at) " +
            "ON CONFLICT(username) DO UPDATE SET last_role = @role, last_login_at = @at;";
        command.Parameters.AddWithValue("@username", username);
        command.Parameters.AddWithValue("@role", role);
        command.Parameters.AddWithValue("@at", at);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<DirectoryUser>> ListDirectoryAsync(
        CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT username, last_role, first_seen_at, last_login_at FROM directory_users " +
            "ORDER BY last_login_at DESC;";

        var users = new List<DirectoryUser>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            users.Add(new DirectoryUser(
                reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3)));
        }
        return users;
    }
}
