using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Logs.V1;
using OpenTelemetry.Proto.Common.V1;
using OpenTelemetry.Proto.Logs.V1;
using System.Text.Json.Nodes;

namespace LogHarbor.Core.Events.Otlp;

/// <summary>The mapped batch plus what was dropped; feeds the OTLP partial_success response.</summary>
public sealed record OtlpParseResult(
    IReadOnlyList<Event> Events, long RejectedLogRecords, string? ErrorMessage);

/// <summary>Maps OTLP LogRecords to Events (docs/ingestion-otlp.md MAPPING).</summary>
public static class OtlpLogParser
{
    // Serilog.Sinks.OpenTelemetry carries the message template in these attributes; the text
    // becomes the message_template column (Analysis grouping), the hash adds nothing on top
    private const string TemplateAttribute = "message_template.text";
    private const string TemplateHashAttribute = "message_template.hash.md5";

    // OTel semantic conventions for exceptions on log records
    private const string ExceptionTypeAttribute = "exception.type";
    private const string ExceptionMessageAttribute = "exception.message";
    private const string ExceptionStacktraceAttribute = "exception.stacktrace";

    private static readonly ulong MaxTicksFromEpoch =
        (ulong)(DateTimeOffset.MaxValue.Ticks - DateTimeOffset.UnixEpoch.Ticks);

    public static OtlpParseResult Parse(
        ExportLogsServiceRequest request, DateTimeOffset serverTime, int maxEventBytes)
    {
        var events = new List<Event>();
        long rejected = 0;
        var ingestedAt = ClefParser.FormatTimestamp(serverTime);

        foreach (var resourceLogs in request.ResourceLogs)
        {
            foreach (var scopeLogs in resourceLogs.ScopeLogs)
            {
                foreach (var record in scopeLogs.LogRecords)
                {
                    if (record.CalculateSize() > maxEventBytes)
                    {
                        rejected++;
                        continue;
                    }
                    events.Add(MapRecord(record, resourceLogs.Resource?.Attributes, serverTime, ingestedAt));
                }
            }
        }

        return new OtlpParseResult(events, rejected,
            rejected > 0 ? $"{rejected} log record(s) exceeded MaxEventBytes ({maxEventBytes})." : null);
    }

    private static Event MapRecord(
        LogRecord record, IEnumerable<KeyValue>? resourceAttributes,
        DateTimeOffset serverTime, string ingestedAt)
    {
        var properties = new JsonObject();
        if (resourceAttributes is not null)
        {
            foreach (var attribute in resourceAttributes)
            {
                properties[attribute.Key] = OtlpValues.ToJsonNode(attribute.Value);
            }
        }

        string? messageTemplate = null;
        string? exceptionType = null;
        string? exceptionMessage = null;
        string? exceptionStacktrace = null;
        foreach (var attribute in record.Attributes)
        {
            switch (attribute.Key)
            {
                case TemplateAttribute when IsString(attribute.Value):
                    messageTemplate = attribute.Value.StringValue;
                    break;
                case TemplateHashAttribute:
                    break; // consumed: useless once the template text is a first-class column
                case ExceptionTypeAttribute when IsString(attribute.Value):
                    exceptionType = attribute.Value.StringValue;
                    break;
                case ExceptionMessageAttribute when IsString(attribute.Value):
                    exceptionMessage = attribute.Value.StringValue;
                    break;
                case ExceptionStacktraceAttribute when IsString(attribute.Value):
                    exceptionStacktrace = attribute.Value.StringValue;
                    break;
                default:
                    // record attributes win over resource attributes on key collision
                    properties[attribute.Key] = OtlpValues.ToJsonNode(attribute.Value);
                    break;
            }
        }

        var message = record.Body?.ValueCase switch
        {
            AnyValue.ValueOneofCase.StringValue => record.Body.StringValue,
            null or AnyValue.ValueOneofCase.None => messageTemplate ?? "",
            // structured bodies stay searchable as their JSON text
            _ => OtlpValues.ToJsonNode(record.Body)?.ToJsonString() ?? "",
        };

        return new Event(
            Id: 0,
            Timestamp: ClefParser.FormatTimestamp(ResolveTimestamp(record, serverTime)),
            Level: MapSeverity(record.SeverityNumber, record.SeverityText),
            Message: message,
            MessageTemplate: messageTemplate,
            Properties: properties.Count > 0 ? properties.ToJsonString() : null,
            Exception: ComposeException(exceptionType, exceptionMessage, exceptionStacktrace),
            IngestedAt: ingestedAt,
            TraceId: ToHexId(record.TraceId, 16),
            SpanId: ToHexId(record.SpanId, 8));
    }

    private static bool IsString(AnyValue? value) =>
        value?.ValueCase == AnyValue.ValueOneofCase.StringValue;

    /// <summary>1-24 severity blocks map onto the six canonical levels (todo.md Phase 12-B);
    /// 0/unspecified falls back to severity_text through the shared alias map.</summary>
    private static string MapSeverity(SeverityNumber number, string severityText) => (int)number switch
    {
        >= 1 and <= 4 => "Verbose",
        >= 5 and <= 8 => "Debug",
        >= 9 and <= 12 => "Information",
        >= 13 and <= 16 => "Warning",
        >= 17 and <= 20 => "Error",
        >= 21 and <= 24 => "Fatal",
        _ => Levels.FromAlias(severityText),
    };

    /// <summary>OTLP allows both timestamps to be empty: time, then observed time, then server clock.</summary>
    private static DateTimeOffset ResolveTimestamp(LogRecord record, DateTimeOffset serverTime)
    {
        var nanos = record.TimeUnixNano != 0 ? record.TimeUnixNano : record.ObservedTimeUnixNano;
        if (nanos == 0)
        {
            return serverTime;
        }
        var ticks = nanos / 100;
        // beyond year 9999 AddTicks would overflow; treat like any other broken clock
        var parsed = ticks > MaxTicksFromEpoch
            ? serverTime
            : DateTimeOffset.UnixEpoch.AddTicks((long)ticks);
        return ClefParser.ClampFuture(parsed, serverTime);
    }

    /// <summary>W3C ids are fixed-length and never all-zero; anything else stores as null
    /// rather than rejecting the record (docs/ingestion-otlp.md MAPPING).</summary>
    private static string? ToHexId(ByteString id, int expectedLength)
    {
        if (id.Length != expectedLength)
        {
            return null;
        }
        var bytes = id.ToByteArray();
        return bytes.All(b => b == 0) ? null : Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static string? ComposeException(string? type, string? message, string? stacktrace)
    {
        // "{type}: {message}" matches .NET Exception.ToString(), so the Analysis page's
        // first-line-up-to-colon grouping works for OTLP events too
        var firstLine = (type, message) switch
        {
            (not null, not null) => $"{type}: {message}",
            (not null, null) => type,
            (null, not null) => message,
            _ => null,
        };
        if (firstLine is null)
        {
            return stacktrace;
        }
        return stacktrace is null ? firstLine : firstLine + "\n" + stacktrace;
    }
}
