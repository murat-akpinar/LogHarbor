using LogHarbor.Core.Events;

namespace LogHarbor.Core.Storage;

public static class SegmentStatus
{
    public const string Cold = "cold";
    public const string Hydrating = "hydrating";
    public const string Hydrated = "hydrated";
}

/// <summary>One compressed daily chunk of archived events (docs/archiving.md).</summary>
public sealed record ArchiveSegment(
    string Day,
    string FilePath,
    long EventCount,
    long SizeBytes,
    long UncompressedBytes,
    string Status,
    string? HydratedAt,
    string? LastAccessedAt);

public interface IArchiveStore
{
    /// <summary>All segments, newest day first.</summary>
    Task<IReadOnlyList<ArchiveSegment>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>Segments whose day falls inside [fromDay, toDay]; null bounds are open. Ordered by day.</summary>
    Task<IReadOnlyList<ArchiveSegment>> ListRangeAsync(
        string? fromDay, string? toDay, CancellationToken cancellationToken = default);

    Task<ArchiveSegment?> FindAsync(string day, CancellationToken cancellationToken = default);

    /// <summary>Distinct UTC days in the hot events table strictly before cutoffDay that have no segment yet.</summary>
    Task<IReadOnlyList<string>> GetArchivableDaysAsync(
        string cutoffDay, CancellationToken cancellationToken = default);

    /// <summary>Hot rows of one UTC day, id ascending.</summary>
    Task<IReadOnlyList<Event>> ReadDayAsync(string day, CancellationToken cancellationToken = default);

    /// <summary>
    /// Records the segment and deletes its hot rows in one transaction. Only rows with
    /// id &lt;= maxId are deleted so events that arrive mid-archive are never lost.
    /// Throws <see cref="ArchiveVerificationException"/> (and rolls back) when the
    /// deleted row count differs from the segment's event count.
    /// </summary>
    Task CommitSegmentAsync(ArchiveSegment segment, long maxId, CancellationToken cancellationToken = default);

    /// <summary>Atomically claims a cold segment for hydration. False when it is not cold.</summary>
    Task<bool> TryBeginHydrationAsync(string day, CancellationToken cancellationToken = default);

    /// <summary>Replaces the segment's cache rows and marks it hydrated, in one transaction.</summary>
    Task CompleteHydrationAsync(
        string day, IReadOnlyList<Event> events, string nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Clears any cache rows and returns the segment to cold (failed or interrupted hydration).</summary>
    Task AbortHydrationAsync(string day, CancellationToken cancellationToken = default);

    /// <summary>Returns segments stuck in 'hydrating' to cold; used at startup after a crash.</summary>
    Task<IReadOnlyList<string>> ResetInterruptedHydrationsAsync(CancellationToken cancellationToken = default);

    /// <summary>Hydrated segments whose last_accessed_at is older than the given UTC timestamp.</summary>
    Task<IReadOnlyList<string>> GetEvictableDaysAsync(
        string lastAccessedBefore, CancellationToken cancellationToken = default);

    /// <summary>Deletes the segment's cache rows and marks it cold, in one transaction.</summary>
    Task EvictAsync(string day, CancellationToken cancellationToken = default);

    /// <summary>Segments whose day is strictly before cutoffDay (retention candidates).</summary>
    Task<IReadOnlyList<ArchiveSegment>> GetSegmentsBeforeAsync(
        string cutoffDay, CancellationToken cancellationToken = default);

    /// <summary>Removes the segment row and any cache rows; the caller deletes the file.</summary>
    Task DeleteSegmentAsync(string day, CancellationToken cancellationToken = default);

    /// <summary>Retention for disabled archiving: deletes hot events older than the UTC timestamp.</summary>
    Task<long> DeleteHotEventsBeforeAsync(string cutoffTimestamp, CancellationToken cancellationToken = default);

    /// <summary>Reclaims free pages after archive/evict/retention deletions.</summary>
    Task IncrementalVacuumAsync(CancellationToken cancellationToken = default);
}

/// <summary>A segment failed verification; the archive step was rolled back and hot rows kept.</summary>
public sealed class ArchiveVerificationException : Exception
{
    public ArchiveVerificationException(string message) : base(message)
    {
    }
}
