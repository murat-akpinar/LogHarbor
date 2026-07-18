namespace LogHarbor.Core.Storage;

public interface ISpanStore
{
    /// <summary>Writes all spans in one transaction; all or nothing.</summary>
    Task WriteBatchAsync(IReadOnlyList<Span> spans, CancellationToken cancellationToken = default);

    /// <summary>All spans of a trace, ordered by start_timestamp then id.</summary>
    Task<IReadOnlyList<Span>> GetTraceAsync(string traceId, CancellationToken cancellationToken = default);

    /// <summary>Deletes spans that started before cutoffUtc; returns the count removed.</summary>
    Task<long> DeleteSpansOlderThanAsync(string cutoffUtc, CancellationToken cancellationToken = default);
}
