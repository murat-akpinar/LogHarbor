using Microsoft.Data.Sqlite;
using LogHarbor.Core.Events;

namespace LogHarbor.Core.Storage;

public sealed class SqliteSignalStore : ISignalStore
{
    private const string Columns = "id, title, filter, created_at";
    private const int SqliteConstraintErrorCode = 19;

    private readonly LogHarborDb _db;

    public SqliteSignalStore(LogHarborDb db) => _db = db;

    public async Task<Signal> CreateAsync(string title, string filter, CancellationToken cancellationToken = default)
    {
        var createdAt = ClefParser.FormatTimestamp(DateTimeOffset.UtcNow);

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO signals (title, filter, created_at) VALUES (@title, @filter, @createdAt); " +
            "SELECT last_insert_rowid();";
        command.Parameters.AddWithValue("@title", title);
        command.Parameters.AddWithValue("@filter", filter);
        command.Parameters.AddWithValue("@createdAt", createdAt);

        long id;
        try
        {
            id = (long)(await command.ExecuteScalarAsync(cancellationToken))!;
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == SqliteConstraintErrorCode)
        {
            throw new DuplicateSignalTitleException(title);
        }

        return new Signal(id, title, filter, createdAt);
    }

    public async Task<IReadOnlyList<Signal>> ListAsync(CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {Columns} FROM signals ORDER BY title;";
        using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var signals = new List<Signal>();
        while (await reader.ReadAsync(cancellationToken))
        {
            signals.Add(ReadSignal(reader));
        }
        return signals;
    }

    public async Task<Signal?> UpdateAsync(
        long id, string title, string filter, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            $"UPDATE signals SET title = @title, filter = @filter WHERE id = @id " +
            $"RETURNING {Columns};";
        command.Parameters.AddWithValue("@title", title);
        command.Parameters.AddWithValue("@filter", filter);
        command.Parameters.AddWithValue("@id", id);

        try
        {
            using var reader = await command.ExecuteReaderAsync(cancellationToken);
            return await reader.ReadAsync(cancellationToken) ? ReadSignal(reader) : null;
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == SqliteConstraintErrorCode)
        {
            throw new DuplicateSignalTitleException(title);
        }
    }

    public async Task<bool> DeleteAsync(long id, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM signals WHERE id = @id;";
        command.Parameters.AddWithValue("@id", id);
        try
        {
            return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == SqliteConstraintErrorCode)
        {
            // alert_rules.signal_id references this signal
            throw new SignalInUseException(id);
        }
    }

    private static Signal ReadSignal(SqliteDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.GetString(2),
        reader.GetString(3));
}
