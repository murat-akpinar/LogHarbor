namespace LogHarbor.Core.Storage;

/// <summary>One OTLP span. Ids are lowercase W3C hex; ParentSpanId is null for a root span.
/// StartTimestamp is UTC ISO-8601; DurationMs is (end - start) in milliseconds, 0 when unknown.
/// StatusCode is unset|ok|error; Attributes is a JSON object string or null.</summary>
public sealed record Span(
    long Id,
    string TraceId,
    string SpanId,
    string? ParentSpanId,
    string Name,
    string Kind,
    string? Service,
    string StartTimestamp,
    double DurationMs,
    string StatusCode,
    string? StatusMessage,
    string? Attributes,
    string IngestedAt);
