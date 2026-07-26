namespace LogHarbor.Core.Storage;

/// <summary>One reading of the database file length, taken on a maintenance pass.</summary>
public sealed record DatabaseSizeSample(string TakenAt, long SizeBytes);

public interface IDatabaseSizeStore
{
    /// <summary>Keeps one reading. A pass that runs twice within the same second overwrites
    /// its own sample rather than failing — the reading is the same measurement either way.</summary>
    Task RecordAsync(long sizeBytes, DateTimeOffset at, CancellationToken cancellationToken = default);

    /// <summary>Readings from <paramref name="since"/> onwards, oldest first.</summary>
    Task<IReadOnlyList<DatabaseSizeSample>> ListSinceAsync(
        DateTimeOffset since, CancellationToken cancellationToken = default);

    /// <summary>Drops readings older than <paramref name="keepDays"/>; returns rows removed.</summary>
    Task<int> PruneAsync(int keepDays, CancellationToken cancellationToken = default);
}
