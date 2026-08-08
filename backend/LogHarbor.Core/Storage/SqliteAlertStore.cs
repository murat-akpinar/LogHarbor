using Microsoft.Data.Sqlite;
using LogHarbor.Core.Events;

namespace LogHarbor.Core.Storage;

public sealed class SqliteAlertStore : IAlertStore
{
    // new columns are appended so reader ordinals never shift for older ones
    private const string Columns =
        "id, title, signal_id, threshold_count, window_minutes, webhook_url, is_enabled, " +
        "created_at, last_triggered_at, last_error, payload_format, condition, " +
        "acknowledged_until, acknowledged_by, filter";

    private const int UniqueConstraintCode = 2067;     // SQLITE_CONSTRAINT_UNIQUE
    private const int ForeignKeyConstraintCode = 787;  // SQLITE_CONSTRAINT_FOREIGNKEY

    private readonly LogHarborDb _db;

    public SqliteAlertStore(LogHarborDb db) => _db = db;

    public async Task<AlertRule> CreateAsync(
        string title, long? signalId, string? filter, int thresholdCount, int windowMinutes, string webhookUrl,
        bool isEnabled, string payloadFormat, string condition, CancellationToken cancellationToken = default)
    {
        var createdAt = ClefParser.FormatTimestamp(DateTimeOffset.UtcNow);

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO alert_rules (title, signal_id, filter, threshold_count, window_minutes, webhook_url, is_enabled, payload_format, condition, created_at) " +
            "VALUES (@title, @signalId, @filter, @threshold, @window, @webhookUrl, @isEnabled, @payloadFormat, @condition, @createdAt); " +
            "SELECT last_insert_rowid();";
        AddRuleParameters(command, title, signalId, filter, thresholdCount, windowMinutes, webhookUrl, isEnabled, payloadFormat, condition);
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
            throw new UnknownSignalException(signalId!.Value);
        }

        return new AlertRule(id, title, signalId, thresholdCount, windowMinutes, webhookUrl, isEnabled,
            createdAt, LastTriggeredAt: null, LastError: null, payloadFormat, condition, Filter: filter);
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
        long id, string title, long? signalId, string? filter, int thresholdCount, int windowMinutes,
        string webhookUrl, bool isEnabled, string payloadFormat, string condition,
        CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE alert_rules SET title = @title, signal_id = @signalId, filter = @filter, " +
            "threshold_count = @threshold, window_minutes = @window, webhook_url = @webhookUrl, " +
            "is_enabled = @isEnabled, payload_format = @payloadFormat, condition = @condition " +
            $"WHERE id = @id RETURNING {Columns};";
        AddRuleParameters(command, title, signalId, filter, thresholdCount, windowMinutes, webhookUrl, isEnabled, payloadFormat, condition);
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
            throw new UnknownSignalException(signalId!.Value);
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
        // LEFT JOIN, not JOIN: a rule carrying its own filter has no signal row to join to, and an
        // inner join would silently drop it from every evaluation pass
        command.CommandText =
            "SELECT r.id, r.title, r.signal_id, r.threshold_count, r.window_minutes, r.webhook_url, " +
            "r.is_enabled, r.created_at, r.last_triggered_at, r.last_error, r.payload_format, r.condition, " +
            "r.acknowledged_until, r.acknowledged_by, r.filter, s.title, s.filter " +
            "FROM alert_rules r LEFT JOIN signals s ON s.id = r.signal_id " +
            "WHERE r.is_enabled = 1 ORDER BY r.id;";

        var alerts = new List<EnabledAlert>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            alerts.Add(new EnabledAlert(
                ReadRule(reader),
                reader.IsDBNull(15) ? null : reader.GetString(15),
                reader.IsDBNull(16) ? null : reader.GetString(16)));
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

    public async Task<AlertRule?> AcknowledgeAsync(
        long id, string? untilUtc, string? by, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE alert_rules SET acknowledged_until = @until, acknowledged_by = @by " +
            $"WHERE id = @id RETURNING {Columns};";
        command.Parameters.AddWithValue("@until", (object?)untilUtc ?? DBNull.Value);
        command.Parameters.AddWithValue("@by", (object?)by ?? DBNull.Value);
        command.Parameters.AddWithValue("@id", id);

        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadRule(reader) : null;
    }

    private static void AddRuleParameters(
        SqliteCommand command, string title, long? signalId, string? filter, int thresholdCount,
        int windowMinutes, string webhookUrl, bool isEnabled, string payloadFormat, string condition)
    {
        command.Parameters.AddWithValue("@title", title);
        command.Parameters.AddWithValue("@signalId", (object?)signalId ?? DBNull.Value);
        command.Parameters.AddWithValue("@filter", (object?)filter ?? DBNull.Value);
        command.Parameters.AddWithValue("@threshold", thresholdCount);
        command.Parameters.AddWithValue("@window", windowMinutes);
        command.Parameters.AddWithValue("@webhookUrl", webhookUrl);
        command.Parameters.AddWithValue("@isEnabled", isEnabled ? 1 : 0);
        command.Parameters.AddWithValue("@payloadFormat", payloadFormat);
        command.Parameters.AddWithValue("@condition", condition);
    }

    private static AlertRule ReadRule(SqliteDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.IsDBNull(2) ? null : reader.GetInt64(2),
        reader.GetInt32(3),
        reader.GetInt32(4),
        reader.GetString(5),
        reader.GetInt64(6) == 1,
        reader.GetString(7),
        reader.IsDBNull(8) ? null : reader.GetString(8),
        reader.IsDBNull(9) ? null : reader.GetString(9),
        reader.GetString(10),
        reader.GetString(11),
        reader.IsDBNull(12) ? null : reader.GetString(12),
        reader.IsDBNull(13) ? null : reader.GetString(13),
        reader.IsDBNull(14) ? null : reader.GetString(14));
}
