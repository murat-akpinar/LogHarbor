using System.Diagnostics.Metrics;

namespace LogHarbor.Core.Telemetry;

/// <summary>
/// LogHarbor's own instruments (docs/superpowers/specs/2026-07-18-self-telemetry-design.md).
/// BCL-only: without a listener (the default — no OTEL_EXPORTER_OTLP_ENDPOINT) these are
/// near-free no-ops, so recording is unconditional at the call sites.
/// </summary>
public static class LogHarborMetrics
{
    public static readonly Meter Meter = new("LogHarbor");

    /// <summary>Stored events per ingestion request; tag "source" is "clef" or "otlp".</summary>
    public static readonly Counter<long> IngestedEvents =
        Meter.CreateCounter<long>("logharbor.ingest.events", unit: "{event}",
            description: "Events stored per ingestion request");

    /// <summary>One search (EventQuery) round-trip through the store, in milliseconds.</summary>
    public static readonly Histogram<double> QueryDuration =
        Meter.CreateHistogram<double>("logharbor.query.duration", unit: "ms",
            description: "Event search duration");

    /// <summary>One archiver compression pass, in milliseconds.</summary>
    public static readonly Histogram<double> ArchiveJobDuration =
        Meter.CreateHistogram<double>("logharbor.archive.job.duration", unit: "ms",
            description: "Archive compression run duration");

    public static void CountIngested(long events, string source) =>
        IngestedEvents.Add(events, new KeyValuePair<string, object?>("source", source));
}
