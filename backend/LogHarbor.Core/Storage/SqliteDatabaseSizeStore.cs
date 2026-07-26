using LogHarbor.Core.Events;

namespace LogHarbor.Core.Storage;

public sealed class SqliteDatabaseSizeStore : IDatabaseSizeStore
{
    /// <summary>Long enough for a weekly rhythm to show in the slope, short enough that the
    /// table stays a few hundred rows at one sample an hour.</summary>
    public const int DefaultKeepDays = 14;

    private readonly LogHarborDb _db;

    public SqliteDatabaseSizeStore(LogHarborDb db) => _db = db;

    public async Task RecordAsync(
        long sizeBytes, DateTimeOffset at, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO db_size_samples (taken_at, size_bytes) VALUES (@takenAt, @sizeBytes) " +
            "ON CONFLICT(taken_at) DO UPDATE SET size_bytes = @sizeBytes;";
        command.Parameters.AddWithValue("@takenAt", ClefParser.FormatTimestamp(at));
        command.Parameters.AddWithValue("@sizeBytes", sizeBytes);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<DatabaseSizeSample>> ListSinceAsync(
        DateTimeOffset since, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT taken_at, size_bytes FROM db_size_samples " +
            "WHERE taken_at >= @since ORDER BY taken_at;";
        command.Parameters.AddWithValue("@since", ClefParser.FormatTimestamp(since));
        using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var samples = new List<DatabaseSizeSample>();
        while (await reader.ReadAsync(cancellationToken))
        {
            samples.Add(new DatabaseSizeSample(reader.GetString(0), reader.GetInt64(1)));
        }
        return samples;
    }

    public async Task<int> PruneAsync(int keepDays, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM db_size_samples WHERE taken_at < @cutoff;";
        command.Parameters.AddWithValue(
            "@cutoff", ClefParser.FormatTimestamp(DateTimeOffset.UtcNow.AddDays(-keepDays)));
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
