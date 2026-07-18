using LogHarbor.Core.Events;
using LogHarbor.Core.Query;

namespace LogHarbor.Core.Storage;

/// <summary>From/To are normalized UTC ISO-8601 strings (string order == time order).</summary>
public sealed record EventQuery(QuerySql? Filter, string? From, string? To, long? AfterId, int Count);

/// <summary>ArchivedDays lists cold (non-hydrated) archive days the query range touches.</summary>
public sealed record EventPage(IReadOnlyList<Event> Events, bool HasMore, IReadOnlyList<string> ArchivedDays);

public sealed record HistogramBucket(string Start, IReadOnlyDictionary<string, long> Counts);

public sealed record StatsSummary(long Total, IReadOnlyDictionary<string, long> ByLevel);

/// <summary>One error group: all events sharing a CLEF message template and level.</summary>
public sealed record TopError(string Template, string Level, long Count, string FirstSeen, string LastSeen);

/// <summary>One exception group, keyed by the first line of the exception text up to ':'.</summary>
public sealed record TopException(string Type, long Count, string FirstSeen, string LastSeen);

public sealed record PropertyValueCount(string Value, long Count);

/// <summary>One operation group whose current-window p95 latency regressed past its own baseline p95.</summary>
public sealed record SlowOperation(string Template, double BaselineP95, double CurrentP95, long Count);

/// <summary>Event count for one (day-of-week, hour-of-day) cell, both UTC; DayOfWeek 0 = Sunday.</summary>
public sealed record HeatmapCell(int DayOfWeek, int Hour, long Count);

/// <summary>RED numbers for one service; P95ElapsedMs is null when no event carried Elapsed.</summary>
public sealed record ServiceOverview(string Service, long Total, long ErrorCount, double? P95ElapsedMs);

public interface IEventStore
{
    /// <summary>Writes all events in a single transaction; all or nothing. Returns the ids assigned, in insertion order.</summary>
    Task<IReadOnlyList<long>> WriteBatchAsync(IReadOnlyList<Event> events, CancellationToken cancellationToken = default);

    /// <summary>Newest first (id DESC), keyset-paged via AfterId.</summary>
    Task<EventPage> QueryAsync(EventQuery query, CancellationToken cancellationToken = default);

    Task<Event?> FindAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Events among <paramref name="ids"/> that match the filter, newest first. Live tail runs each
    /// subscriber's filter through this so matching uses the same SQL semantics as search.
    /// </summary>
    Task<IReadOnlyList<Event>> MatchAsync(
        QuerySql? filter, IReadOnlyList<long> ids, CancellationToken cancellationToken = default);

    /// <summary>Splits [from, to] into equal-width buckets and counts matching events per level in each.</summary>
    Task<IReadOnlyList<HistogramBucket>> GetHistogramAsync(
        QuerySql? filter, DateTimeOffset from, DateTimeOffset to, int buckets, CancellationToken cancellationToken = default);

    Task<StatsSummary> GetSummaryAsync(
        QuerySql? filter, string fromUtc, string toUtc, CancellationToken cancellationToken = default);

    /// <summary>Counts by (message_template, level) for the given levels, most frequent first. Searches hot + hydrated data.</summary>
    Task<IReadOnlyList<TopError>> GetTopErrorsAsync(
        QuerySql? filter, string fromUtc, string toUtc, IReadOnlyList<string> levels, int limit,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Operation groups (by message template) whose current-window p95 of the numeric
    /// <paramref name="property"/> is at least <paramref name="factor"/>x the group's baseline p95
    /// (history in [baselineFromUtc, splitUtc)), most-regressed first. Guardrails: a group needs
    /// >= <paramref name="minSamples"/> timed events in each window and a baseline p95 >= <paramref name="floorMs"/>.
    /// </summary>
    Task<IReadOnlyList<SlowOperation>> GetSlowOperationsAsync(
        QuerySql? filter, string baselineFromUtc, string splitUtc, string toUtc,
        string property, int minSamples, double floorMs, double factor, int limit,
        CancellationToken cancellationToken = default);

    /// <summary>Counts by exception type, most frequent first. Searches hot + hydrated data.</summary>
    Task<IReadOnlyList<TopException>> GetTopExceptionsAsync(
        QuerySql? filter, string fromUtc, string toUtc, int limit, CancellationToken cancellationToken = default);

    /// <summary>
    /// Top values of one property with counts, most frequent first. Searches hot + hydrated data.
    /// <paramref name="property"/> must be a bare identifier ([A-Za-z0-9_.]); the API boundary validates it.
    /// </summary>
    Task<IReadOnlyList<PropertyValueCount>> GetPropertyValuesAsync(
        QuerySql? filter, string fromUtc, string toUtc, string property, int limit,
        CancellationToken cancellationToken = default);

    /// <summary>Counts by (day-of-week, hour-of-day) UTC, ordered by day then hour. Searches hot + hydrated data.</summary>
    Task<IReadOnlyList<HeatmapCell>> GetHeatmapAsync(
        QuerySql? filter, string fromUtc, string toUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// Per-service totals, Error+Fatal counts and p95 of Elapsed, largest first. Service identity
    /// is the "service.name" property (OTLP resources) falling back to "Service" (CLEF/Seq senders);
    /// events carrying neither are excluded. Searches hot + hydrated data.
    /// </summary>
    Task<IReadOnlyList<ServiceOverview>> GetServiceOverviewAsync(
        QuerySql? filter, string fromUtc, string toUtc, int limit, CancellationToken cancellationToken = default);

    /// <summary>Distinct property names in recent events, prefix-filtered (search-bar autocomplete).</summary>
    Task<IReadOnlyList<string>> SuggestPropertyNamesAsync(
        string prefix, int limit, CancellationToken cancellationToken = default);

    /// <summary>Distinct values of one property in recent events, prefix-filtered.</summary>
    Task<IReadOnlyList<string>> SuggestPropertyValuesAsync(
        string property, string prefix, int limit, CancellationToken cancellationToken = default);
}
