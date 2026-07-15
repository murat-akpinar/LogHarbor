using Microsoft.Data.Sqlite;
using LogHarbor.Core.Events;

namespace LogHarbor.Core.Storage;

public sealed class SqliteAlertStore : IAlertStore
{
    private const string Columns =
        "id, title, signal_id, threshold_count, window_minutes, webhook_url, is_enabled, " +
        "created_at, last_triggered_at, last_error";

    private const int UniqueConstraintCode = 2067;     // SQLITE_CONSTRAINT_UNIQUE
    private const int ForeignKeyConstraintCode = 787;  // SQLITE_CONSTRAINT_FOREIGNKEY

    private readonly LogHarborDb _db;

    public SqliteAlertStore(LogHarborDb db) => _db = db;

    public async Task<AlertRule> CreateAsync(
        string title, long signalId, int thresholdCount, int windowMinutes, string webhookUrl,
        bool isEnabled, CancellationToken cancellationToken = default)
    {
        var createdAt = ClefParser.FormatTimestamp(DateTimeOffset.UtcNow);

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO alert_rules (title, signal_id, threshold_count, window_minutes, webhook_url, is_enabled, created_at) " +
            "VALUES (@title, @signalId, @threshold, @window, @webhookUrl, @isEnabled, @createdAt); " +
            "SELECT last_insert_rowid();";
        AddRuleParameters(command, title, signalId, thresholdCount, windowMinutes, webhookUrl, isEnabled);
        command.Parameters.AddWithValue("@createdAt", createdAt);

        long id;
        try
        {
            id = (long)(await command.ExecuteScalarAsync(cancellationToken))!;
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == UniqueConstraintCode)
        {
            throw new DuplicateAlertTitleException(title);
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == ForeignKeyConstraintCode)
        {
            throw new UnknownSignalException(signalId);
        }

        return new AlertRule(id, title, signalId, thresholdCount, windowMinutes, webhookUrl, isEnabled,
            createdAt, LastTriggeredAt: null, LastError: null);
    }

    public async Task<IReadOnlyList<AlertRule>> ListAsync(CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {Columns} FROM alert_rules ORDER BY title;";

        var rules = new List<AlertRule>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rules.Add(ReadRule(reader));
        }
        return rules;
    }

    public async Task<AlertRule?> UpdateAsync(
        long id, string title, long signalId, int thresholdCount, int windowMinutes, string webhookUrl,
        bool isEnabled, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE alert_rules SET title = @title, signal_id = @signalId, threshold_count = @threshold, " +
            "window_minutes = @window, webhook_url = @webhookUrl, is_enabled = @isEnabled " +
            $"WHERE id = @id RETURNING {Columns};";
        AddRuleParameters(command, title, signalId, thresholdCount, windowMinutes, webhookUrl, isEnabled);
        command.Parameters.AddWithValue("@id", id);

        try
        {
            using var reader = await command.ExecuteReaderAsync(cancellationToken);
            return await reader.ReadAsync(cancellationToken) ? ReadRule(reader) : null;
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == UniqueConstraintCode)
        {
            throw new DuplicateAlertTitleException(title);
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == ForeignKeyConstraintCode)
        {
            throw new UnknownSignalException(signalId);
        }
    }

    public async Task<bool> DeleteAsync(long id, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM alert_rules WHERE id = @id;";
        command.Parameters.AddWithValue("@id", id);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    public async Task<IReadOnlyList<EnabledAlert>> GetEnabledWithSignalAsync(
        CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT r.id, r.title, r.signal_id, r.threshold_count, r.window_minutes, r.webhook_url, " +
            "r.is_enabled, r.created_at, r.last_triggered_at, r.last_error, s.title, s.filter " +
            "FROM alert_rules r JOIN signals s ON s.id = r.signal_id " +
            "WHERE r.is_enabled = 1 ORDER BY r.id;";

        var alerts = new List<EnabledAlert>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            alerts.Add(new EnabledAlert(ReadRule(reader), reader.GetString(10), reader.GetString(11)));
        }
        return alerts;
    }

    public async Task MarkTriggeredAsync(
        long id, string atUtc, string? error, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE alert_rules SET last_triggered_at = @at, last_error = @error WHERE id = @id;";
        command.Parameters.AddWithValue("@at", atUtc);
        command.Parameters.AddWithValue("@error", (object?)error ?? DBNull.Value);
        command.Parameters.AddWithValue("@id", id);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task SetErrorAsync(long id, string error, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE alert_rules SET last_error = @error WHERE id = @id;";
        command.Parameters.AddWithValue("@error", error);
        command.Parameters.AddWithValue("@id", id);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static void AddRuleParameters(
        SqliteCommand command, string title, long signalId, int thresholdCount, int windowMinutes,
        string webhookUrl, bool isEnabled)
    {
        command.Parameters.AddWithValue("@title", title);
        command.Parameters.AddWithValue("@signalId", signalId);
        command.Parameters.AddWithValue("@threshold", thresholdCount);
        command.Parameters.AddWithValue("@window", windowMinutes);
        command.Parameters.AddWithValue("@webhookUrl", webhookUrl);
        command.Parameters.AddWithValue("@isEnabled", isEnabled ? 1 : 0);
    }

    private static AlertRule ReadRule(SqliteDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.GetInt64(2),
        reader.GetInt32(3),
        reader.GetInt32(4),
        reader.GetString(5),
        reader.GetInt64(6) == 1,
        reader.GetString(7),
        reader.IsDBNull(8) ? null : reader.GetString(8),
        reader.IsDBNull(9) ? null : reader.GetString(9));
}
