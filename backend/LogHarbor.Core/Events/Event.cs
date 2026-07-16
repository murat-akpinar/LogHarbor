namespace LogHarbor.Core.Events;

/// <summary>One structured log entry (docs/data-model.md). Timestamps are UTC ISO-8601 strings.
/// TraceId/SpanId are lowercase W3C hex; trailing defaults keep pre-trace call sites valid.</summary>
public sealed record Event(
    long Id,
    string Timestamp,
    string Level,
    string Message,
    string? MessageTemplate,
    string? Properties,
    string? Exception,
    string IngestedAt,
    string? TraceId = null,
    string? SpanId = null);
