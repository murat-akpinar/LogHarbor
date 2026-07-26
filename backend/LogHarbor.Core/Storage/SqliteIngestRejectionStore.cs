using System.Globalization;
using LogHarbor.Core.Events;

namespace LogHarbor.Core.Storage;

public sealed class SqliteIngestRejectionStore : IIngestRejectionStore
{
    /// <summary>Enough to spot a client that has been failing since the weekend, without
    /// keeping a year of buckets nobody reads.</summary>
    public const int DefaultKeepDays = 30;

    private const int MaxDetailLength = 200;

    private readonly LogHarborDb _db;

    public SqliteIngestRejectionStore(LogHarborDb db) => _db = db;

    public async Task RecordAsync(
        long apiKeyId, string reason, string? detail, DateTimeOffset at,
        CancellationToken cancellationToken = default)
    {
        var timestamp = ClefParser.FormatTimestamp(at);

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO ingest_rejections " +
            "  (api_key_id, reason, day, request_count, first_seen, last_seen, last_detail) " +
            "VALUES (@apiKeyId, @reason, @day, 1, @at, @at, @detail) " +
            "ON CONFLICT(api_key_id, reason, day) DO UPDATE SET " +
            "  request_count = request_count + 1, last_seen = @at, last_detail = @detail;";
        command.Parameters.AddWithValue("@apiKeyId", apiKeyId);
        command.Parameters.AddWithValue("@reason", reason);
        command.Parameters.AddWithValue("@day", DayOf(at));
        command.Parameters.AddWithValue("@at", timestamp);
        command.Parameters.AddWithValue("@detail", (object?)Truncate(detail) ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<IngestRejection>> ListAsync(
        int days, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT r.api_key_id, k.title, r.reason, r.day, r.request_count, " +
            "       r.first_seen, r.last_seen, r.last_detail " +
            "FROM ingest_rejections r " +
            "LEFT JOIN api_keys k ON k.id = r.api_key_id " +
            "WHERE r.day >= @from " +
            "ORDER BY r.last_seen DESC;";
        command.Parameters.AddWithValue("@from", DayOf(DateTimeOffset.UtcNow.AddDays(-days)));
        using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var rejections = new List<IngestRejection>();
        while (await reader.ReadAsync(cancellationToken))
        {
            rejections.Add(new IngestRejection(
                ApiKeyId: reader.GetInt64(0),
                ApiKeyTitle: reader.IsDBNull(1) ? null : reader.GetString(1),
                Reason: reader.GetString(2),
                Day: reader.GetString(3),
                RequestCount: reader.GetInt64(4),
                FirstSeen: reader.GetString(5),
                LastSeen: reader.GetString(6),
                LastDetail: reader.IsDBNull(7) ? null : reader.GetString(7)));
        }
        return rejections;
    }

    public async Task<int> PruneAsync(int keepDays, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM ingest_rejections WHERE day < @from;";
        command.Parameters.AddWithValue("@from", DayOf(DateTimeOffset.UtcNow.AddDays(-keepDays)));
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string DayOf(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>The detail is a server-written reason, but it can quote a client's payload
    /// (a parse error names the offending line), so it is capped rather than stored whole.</summary>
    private static string? Truncate(string? detail) =>
        detail is null || detail.Length <= MaxDetailLength
            ? detail
            : detail[..MaxDetailLength];
}
