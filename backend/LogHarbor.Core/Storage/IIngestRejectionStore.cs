namespace LogHarbor.Core.Storage;

/// <summary>Why ingestion did not keep a client's events. Stored as the wire reason rather
/// than the status code so the UI can name it without a lookup table.</summary>
public static class RejectionReasons
{
    public const string Unauthorized = "unauthorized";
    public const string RateLimited = "rate_limited";
    public const string InvalidPayload = "invalid_payload";
    public const string TooLarge = "too_large";
    public const string UnsupportedMediaType = "unsupported_media_type";

    /// <summary>The batch was valid and we failed to store it — a full disk, a read-only
    /// mount, a locked database. The graver half: the client did nothing wrong, so nothing
    /// on its side will ever be corrected, and the events are simply gone.</summary>
    public const string WriteFailed = "write_failed";
}

/// <summary>One (key, reason, day) bucket. ApiKeyTitle is null when the request had no valid
/// key — there is no key row to name.</summary>
public sealed record IngestRejection(
    long ApiKeyId,
    string? ApiKeyTitle,
    string Reason,
    string Day,
    long RequestCount,
    string FirstSeen,
    string LastSeen,
    string? LastDetail);

public interface IIngestRejectionStore
{
    /// <summary>Adds one rejection to its bucket. apiKeyId 0 means no valid key.</summary>
    Task RecordAsync(
        long apiKeyId, string reason, string? detail, DateTimeOffset at,
        CancellationToken cancellationToken = default);

    /// <summary>Buckets from the last <paramref name="days"/> UTC days, newest activity first.</summary>
    Task<IReadOnlyList<IngestRejection>> ListAsync(int days, CancellationToken cancellationToken = default);

    /// <summary>Drops buckets older than <paramref name="keepDays"/>; returns rows removed.</summary>
    Task<int> PruneAsync(int keepDays, CancellationToken cancellationToken = default);

    /// <summary>When a reason was last recorded, or null if never. The health check reads
    /// write_failed through this: a probe can only guess whether the next write will work,
    /// but a recorded failure is a write that actually did not.</summary>
    Task<string?> GetLastSeenAsync(string reason, CancellationToken cancellationToken = default);
}
