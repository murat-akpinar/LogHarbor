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

    /// <summary>One successful ingestion request (parse + write + broadcast), in milliseconds;
    /// tag "source" is "clef" or "otlp". The tripwire for the parked write-path channel refactor:
    /// its p99 degrading in a real deployment is the signal to revisit (todo.md Phase 13).</summary>
    public static readonly Histogram<double> IngestDuration =
        Meter.CreateHistogram<double>("logharbor.ingest.duration", unit: "ms",
            description: "Successful ingestion request duration");

    public static void RecordIngestDuration(double milliseconds, string source) =>
        IngestDuration.Record(milliseconds, new KeyValuePair<string, object?>("source", source));

    /// <summary>One archiver compression pass, in milliseconds.</summary>
    public static readonly Histogram<double> ArchiveJobDuration =
        Meter.CreateHistogram<double>("logharbor.archive.job.duration", unit: "ms",
            description: "Archive compression run duration");

    public static void CountIngested(long events, string source) =>
        IngestedEvents.Add(events, new KeyValuePair<string, object?>("source", source));
}
