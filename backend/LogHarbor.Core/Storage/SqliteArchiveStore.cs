using Microsoft.Data.Sqlite;
using LogHarbor.Core.Events;

namespace LogHarbor.Core.Storage;

public sealed class SqliteArchiveStore : IArchiveStore
{
    private const string SegmentColumns =
        "day, file_path, event_count, size_bytes, uncompressed_bytes, status, hydrated_at, last_accessed_at";

    private const string EventColumns =
        "id, timestamp, level, message, message_template, properties, exception, ingested_at";

    private readonly LogHarborDb _db;

    public SqliteArchiveStore(LogHarborDb db) => _db = db;

    public async Task<IReadOnlyList<ArchiveSegment>> ListAsync(CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {SegmentColumns} FROM archive_segments ORDER BY day DESC;";
        return await ReadSegmentsAsync(command, cancellationToken);
    }

    public async Task<IReadOnlyList<ArchiveSegment>> ListRangeAsync(
        string? fromDay, string? toDay, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            $"SELECT {SegmentColumns} FROM archive_segments " +
            "WHERE (@fromDay IS NULL OR day >= @fromDay) AND (@toDay IS NULL OR day <= @toDay) " +
            "ORDER BY day;";
        command.Parameters.AddWithValue("@fromDay", (object?)fromDay ?? DBNull.Value);
        command.Parameters.AddWithValue("@toDay", (object?)toDay ?? DBNull.Value);
        return await ReadSegmentsAsync(command, cancellationToken);
    }

    public async Task<ArchiveSegment?> FindAsync(string day, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {SegmentColumns} FROM archive_segments WHERE day = @day;";
        command.Parameters.AddWithValue("@day", day);

        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadSegment(reader) : null;
    }

    public async Task<IReadOnlyList<string>> GetArchivableDaysAsync(
        string cutoffDay, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        // a day that already has a segment is never re-archived: late arrivals for such a day
        // stay hot rather than risk merging into a verified file (docs/archiving.md)
        command.CommandText =
            "SELECT DISTINCT substr(timestamp, 1, 10) AS day FROM events " +
            "WHERE timestamp < @cutoffStart " +
            "AND day NOT IN (SELECT day FROM archive_segments) " +
            "ORDER BY day;";
        command.Parameters.AddWithValue("@cutoffStart", DayStart(cutoffDay));

        var days = new List<string>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            days.Add(reader.GetString(0));
        }
        return days;
    }

    public async Task<IReadOnlyList<Event>> ReadDayAsync(string day, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            $"SELECT {EventColumns} FROM events " +
            "WHERE timestamp >= @start AND timestamp < @end ORDER BY id;";
        command.Parameters.AddWithValue("@start", DayStart(day));
        command.Parameters.AddWithValue("@end", DayStart(NextDay(day)));

        var events = new List<Event>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            events.Add(ReadEvent(reader));
        }
        return events;
    }

    public async Task CommitSegmentAsync(
        ArchiveSegment segment, long maxId, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);

        using (var insert = connection.CreateCommand())
        {
            insert.Transaction = transaction;
            insert.CommandText =
                "INSERT INTO archive_segments (day, file_path, event_count, size_bytes, uncompressed_bytes, status) " +
                "VALUES (@day, @filePath, @eventCount, @sizeBytes, @uncompressedBytes, @status);";
            insert.Parameters.AddWithValue("@day", segment.Day);
            insert.Parameters.AddWithValue("@filePath", segment.FilePath);
            insert.Parameters.AddWithValue("@eventCount", segment.EventCount);
            insert.Parameters.AddWithValue("@sizeBytes", segment.SizeBytes);
            insert.Parameters.AddWithValue("@uncompressedBytes", segment.UncompressedBytes);
            insert.Parameters.AddWithValue("@status", SegmentStatus.Cold);
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        long deleted;
        using (var delete = connection.CreateCommand())
        {
            delete.Transaction = transaction;
            delete.CommandText =
                "DELETE FROM events WHERE timestamp >= @start AND timestamp < @end AND id <= @maxId;";
            delete.Parameters.AddWithValue("@start", DayStart(segment.Day));
            delete.Parameters.AddWithValue("@end", DayStart(NextDay(segment.Day)));
            delete.Parameters.AddWithValue("@maxId", maxId);
            deleted = await delete.ExecuteNonQueryAsync(cancellationToken);
        }

        if (deleted != segment.EventCount)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ArchiveVerificationException(
                $"day {segment.Day}: exported {segment.EventCount} events but matched {deleted} hot rows; " +
                "keeping hot data.");
        }

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<bool> TryBeginHydrationAsync(string day, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE archive_segments SET status = @hydrating WHERE day = @day AND status = @cold;";
        command.Parameters.AddWithValue("@hydrating", SegmentStatus.Hydrating);
        command.Parameters.AddWithValue("@day", day);
        command.Parameters.AddWithValue("@cold", SegmentStatus.Cold);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    public async Task CompleteHydrationAsync(
        string day, IReadOnlyList<Event> events, string nowUtc, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);

        using (var clear = connection.CreateCommand())
        {
            clear.Transaction = transaction;
            clear.CommandText = "DELETE FROM events_cache WHERE segment_day = @day;";
            clear.Parameters.AddWithValue("@day", day);
            await clear.ExecuteNonQueryAsync(cancellationToken);
        }

        using (var insert = connection.CreateCommand())
        {
            insert.Transaction = transaction;
            insert.CommandText =
                "INSERT INTO events_cache " +
                "(id, timestamp, level, message, message_template, properties, exception, ingested_at, segment_day) " +
                "VALUES (@id, @timestamp, @level, @message, @messageTemplate, @properties, @exception, @ingestedAt, @day);";

            var id = insert.Parameters.Add("@id", SqliteType.Integer);
            var timestamp = insert.Parameters.Add("@timestamp", SqliteType.Text);
            var level = insert.Parameters.Add("@level", SqliteType.Text);
            var message = insert.Parameters.Add("@message", SqliteType.Text);
            var messageTemplate = insert.Parameters.Add("@messageTemplate", SqliteType.Text);
            var properties = insert.Parameters.Add("@properties", SqliteType.Text);
            var exception = insert.Parameters.Add("@exception", SqliteType.Text);
            var ingestedAt = insert.Parameters.Add("@ingestedAt", SqliteType.Text);
            insert.Parameters.AddWithValue("@day", day);

            foreach (var item in events)
            {
                id.Value = item.Id;
                timestamp.Value = item.Timestamp;
                level.Value = item.Level;
                message.Value = item.Message;
                messageTemplate.Value = (object?)item.MessageTemplate ?? DBNull.Value;
                properties.Value = (object?)item.Properties ?? DBNull.Value;
                exception.Value = (object?)item.Exception ?? DBNull.Value;
                ingestedAt.Value = item.IngestedAt;
                await insert.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        using (var mark = connection.CreateCommand())
        {
            mark.Transaction = transaction;
            mark.CommandText =
                "UPDATE archive_segments SET status = @hydrated, hydrated_at = @now, last_accessed_at = @now " +
                "WHERE day = @day;";
            mark.Parameters.AddWithValue("@hydrated", SegmentStatus.Hydrated);
            mark.Parameters.AddWithValue("@now", nowUtc);
            mark.Parameters.AddWithValue("@day", day);
            await mark.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task AbortHydrationAsync(string day, CancellationToken cancellationToken = default)
    {
        await ClearAndMarkColdAsync(day, cancellationToken);
    }

    public async Task<IReadOnlyList<string>> ResetInterruptedHydrationsAsync(
        CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();

        var days = new List<string>();
        using (var find = connection.CreateCommand())
        {
            find.CommandText = "SELECT day FROM archive_segments WHERE status = @hydrating;";
            find.Parameters.AddWithValue("@hydrating", SegmentStatus.Hydrating);
            using var reader = await find.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                days.Add(reader.GetString(0));
            }
        }

        foreach (var day in days)
        {
            await ClearAndMarkColdAsync(day, cancellationToken);
        }
        return days;
    }

    public async Task<IReadOnlyList<string>> GetEvictableDaysAsync(
        string lastAccessedBefore, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT day FROM archive_segments " +
            "WHERE status = @hydrated AND last_accessed_at < @before ORDER BY day;";
        command.Parameters.AddWithValue("@hydrated", SegmentStatus.Hydrated);
        command.Parameters.AddWithValue("@before", lastAccessedBefore);

        var days = new List<string>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            days.Add(reader.GetString(0));
        }
        return days;
    }

    public async Task EvictAsync(string day, CancellationToken cancellationToken = default)
    {
        await ClearAndMarkColdAsync(day, cancellationToken);
    }

    public async Task<IReadOnlyList<ArchiveSegment>> GetSegmentsBeforeAsync(
        string cutoffDay, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            $"SELECT {SegmentColumns} FROM archive_segments WHERE day < @cutoffDay ORDER BY day;";
        command.Parameters.AddWithValue("@cutoffDay", cutoffDay);
        return await ReadSegmentsAsync(command, cancellationToken);
    }

    public async Task DeleteSegmentAsync(string day, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);

        // cache rows first: events_cache.segment_day references archive_segments(day)
        using (var clearCache = connection.CreateCommand())
        {
            clearCache.Transaction = transaction;
            clearCache.CommandText = "DELETE FROM events_cache WHERE segment_day = @day;";
            clearCache.Parameters.AddWithValue("@day", day);
            await clearCache.ExecuteNonQueryAsync(cancellationToken);
        }
        using (var deleteSegment = connection.CreateCommand())
        {
            deleteSegment.Transaction = transaction;
            deleteSegment.CommandText = "DELETE FROM archive_segments WHERE day = @day;";
            deleteSegment.Parameters.AddWithValue("@day", day);
            await deleteSegment.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<long> DeleteHotEventsBeforeAsync(
        string cutoffTimestamp, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM events WHERE timestamp < @cutoff;";
        command.Parameters.AddWithValue("@cutoff", cutoffTimestamp);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task IncrementalVacuumAsync(CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA incremental_vacuum;";
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    internal static string DayStart(string day) => day + "T00:00:00.0000000Z";

    internal static string NextDay(string day) =>
        DateOnly.ParseExact(day, "yyyy-MM-dd").AddDays(1).ToString("yyyy-MM-dd");

    private async Task ClearAndMarkColdAsync(string day, CancellationToken cancellationToken)
    {
        using var connection = _db.OpenConnection();
        using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);

        using (var clear = connection.CreateCommand())
        {
            clear.Transaction = transaction;
            clear.CommandText = "DELETE FROM events_cache WHERE segment_day = @day;";
            clear.Parameters.AddWithValue("@day", day);
            await clear.ExecuteNonQueryAsync(cancellationToken);
        }
        using (var mark = connection.CreateCommand())
        {
            mark.Transaction = transaction;
            mark.CommandText =
                "UPDATE archive_segments SET status = @cold, hydrated_at = NULL, last_accessed_at = NULL " +
                "WHERE day = @day;";
            mark.Parameters.AddWithValue("@cold", SegmentStatus.Cold);
            mark.Parameters.AddWithValue("@day", day);
            await mark.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    private static async Task<IReadOnlyList<ArchiveSegment>> ReadSegmentsAsync(
        SqliteCommand command, CancellationToken cancellationToken)
    {
        var segments = new List<ArchiveSegment>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            segments.Add(ReadSegment(reader));
        }
        return segments;
    }

    private static ArchiveSegment ReadSegment(SqliteDataReader reader) => new(
        reader.GetString(0),
        reader.GetString(1),
        reader.GetInt64(2),
        reader.GetInt64(3),
        reader.GetInt64(4),
        reader.GetString(5),
        reader.IsDBNull(6) ? null : reader.GetString(6),
        reader.IsDBNull(7) ? null : reader.GetString(7));

    private static Event ReadEvent(SqliteDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.GetString(2),
        reader.GetString(3),
        reader.IsDBNull(4) ? null : reader.GetString(4),
        reader.IsDBNull(5) ? null : reader.GetString(5),
        reader.IsDBNull(6) ? null : reader.GetString(6),
        reader.GetString(7));
}
