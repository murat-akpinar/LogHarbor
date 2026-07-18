using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Trace.V1;
using OpenTelemetry.Proto.Common.V1;
using System.Text.Json.Nodes;
using LogHarbor.Core.Storage;
using OtlpSpan = OpenTelemetry.Proto.Trace.V1.Span;
using SpanKind = OpenTelemetry.Proto.Trace.V1.Span.Types.SpanKind;
using StatusCode = OpenTelemetry.Proto.Trace.V1.Status.Types.StatusCode;

namespace LogHarbor.Core.Events.Otlp;

/// <summary>The mapped spans plus what was dropped; feeds the OTLP partial_success response.</summary>
public sealed record OtlpTraceParseResult(
    IReadOnlyList<Span> Spans, long RejectedSpans, string? ErrorMessage);

/// <summary>Maps OTLP spans to Span rows (docs/ingestion-otlp.md). A span with no usable
/// trace/span id, or larger than MaxEventBytes, is rejected rather than stored.</summary>
public static class OtlpTraceParser
{
    private const string ServiceNameKey = "service.name";

    public static OtlpTraceParseResult Parse(
        ExportTraceServiceRequest request, DateTimeOffset serverTime, int maxSpanBytes)
    {
        var spans = new List<Span>();
        long rejected = 0;
        var ingestedAt = ClefParser.FormatTimestamp(serverTime);

        foreach (var resourceSpans in request.ResourceSpans)
        {
            var service = ResolveService(resourceSpans.Resource?.Attributes);
            foreach (var scopeSpans in resourceSpans.ScopeSpans)
            {
                foreach (var span in scopeSpans.Spans)
                {
                    var traceId = ToHexId(span.TraceId, 16);
                    var spanId = ToHexId(span.SpanId, 8);
                    if (traceId is null || spanId is null || span.CalculateSize() > maxSpanBytes)
                    {
                        rejected++;
                        continue;
                    }
                    spans.Add(MapSpan(span, traceId, spanId, service, serverTime, ingestedAt));
                }
            }
        }

        return new OtlpTraceParseResult(spans, rejected,
            rejected > 0
                ? $"{rejected} span(s) rejected (missing id or exceeded MaxEventBytes {maxSpanBytes})."
                : null);
    }

    private static Span MapSpan(
        OtlpSpan span, string traceId, string spanId, string? service,
        DateTimeOffset serverTime, string ingestedAt)
    {
        var attributes = new JsonObject();
        foreach (var attribute in span.Attributes)
        {
            attributes[attribute.Key] = OtlpValues.ToJsonNode(attribute.Value);
        }

        var duration = span.EndTimeUnixNano > span.StartTimeUnixNano
            ? (span.EndTimeUnixNano - span.StartTimeUnixNano) / 1_000_000.0
            : 0;

        return new Span(
            Id: 0,
            TraceId: traceId,
            SpanId: spanId,
            ParentSpanId: ToHexId(span.ParentSpanId, 8),
            Name: span.Name,
            Kind: MapKind(span.Kind),
            Service: service,
            StartTimestamp: ClefParser.FormatTimestamp(ResolveStart(span.StartTimeUnixNano, serverTime)),
            DurationMs: duration,
            StatusCode: MapStatus(span.Status?.Code),
            StatusMessage: string.IsNullOrEmpty(span.Status?.Message) ? null : span.Status!.Message,
            Attributes: attributes.Count > 0 ? attributes.ToJsonString() : null,
            IngestedAt: ingestedAt);
    }

    private static string MapKind(SpanKind kind) => kind switch
    {
        SpanKind.Internal => "internal",
        SpanKind.Server => "server",
        SpanKind.Client => "client",
        SpanKind.Producer => "producer",
        SpanKind.Consumer => "consumer",
        _ => "unspecified",
    };

    private static string MapStatus(StatusCode? code) => code switch
    {
        StatusCode.Ok => "ok",
        StatusCode.Error => "error",
        _ => "unset",
    };

    private static string? ResolveService(IEnumerable<KeyValue>? attributes)
    {
        if (attributes is null)
        {
            return null;
        }
        foreach (var attribute in attributes)
        {
            if (attribute.Key == ServiceNameKey
                && attribute.Value.ValueCase == AnyValue.ValueOneofCase.StringValue)
            {
                return attribute.Value.StringValue;
            }
        }
        return null;
    }

    /// <summary>Empty start clock falls back to the server clock; far-future clocks are clamped
    /// exactly like log timestamps.</summary>
    private static DateTimeOffset ResolveStart(ulong startNanos, DateTimeOffset serverTime)
    {
        if (startNanos == 0)
        {
            return serverTime;
        }
        var parsed = DateTimeOffset.UnixEpoch.AddTicks((long)(startNanos / 100));
        return ClefParser.ClampFuture(parsed, serverTime);
    }

    /// <summary>W3C ids are fixed-length and never all-zero; anything else is null (a null
    /// trace/span id rejects the span, a null parent id marks a root).</summary>
    private static string? ToHexId(ByteString id, int expectedLength)
    {
        if (id.Length != expectedLength)
        {
            return null;
        }
        var bytes = id.ToByteArray();
        return bytes.All(b => b == 0) ? null : Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
