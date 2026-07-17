using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Logs.V1;
using OpenTelemetry.Proto.Common.V1;
using OpenTelemetry.Proto.Logs.V1;
using LogHarbor.Core.Events;
using LogHarbor.Core.Events.Otlp;
using OtlpResource = OpenTelemetry.Proto.Resource.V1.Resource;

namespace LogHarbor.Tests.Events;

public sealed class OtlpLogParserTests
{
    private static readonly DateTimeOffset ServerTime =
        new(2026, 7, 13, 12, 0, 0, TimeSpan.Zero);

    private const int MaxEventBytes = 256 * 1024;

    // 2026-07-13T10:00:00Z in unix nanoseconds
    private const ulong TenAm = 1_783_936_800_000_000_000UL;

    private static KeyValue Attr(string key, string value) =>
        new() { Key = key, Value = new AnyValue { StringValue = value } };

    private static ExportLogsServiceRequest Wrap(LogRecord record, params KeyValue[] resourceAttributes)
    {
        var resourceLogs = new ResourceLogs { Resource = new OtlpResource() };
        resourceLogs.Resource.Attributes.AddRange(resourceAttributes);
        var scope = new ScopeLogs();
        scope.LogRecords.Add(record);
        resourceLogs.ScopeLogs.Add(scope);
        var request = new ExportLogsServiceRequest();
        request.ResourceLogs.Add(resourceLogs);
        return request;
    }

    private static Event ParseSingle(LogRecord record, params KeyValue[] resourceAttributes)
    {
        var result = OtlpLogParser.Parse(Wrap(record, resourceAttributes), ServerTime, MaxEventBytes);
        Assert.Equal(0, result.RejectedLogRecords);
        return Assert.Single(result.Events);
    }

    [Theory]
    [InlineData(1, "Verbose")]
    [InlineData(4, "Verbose")]
    [InlineData(5, "Debug")]
    [InlineData(9, "Information")]
    [InlineData(12, "Information")]
    [InlineData(13, "Warning")]
    [InlineData(17, "Error")]
    [InlineData(21, "Fatal")]
    [InlineData(24, "Fatal")]
    public void SeverityNumber_MapsToCanonicalLevel(int number, string expected)
    {
        var record = new LogRecord { TimeUnixNano = TenAm, SeverityNumber = (SeverityNumber)number };
        Assert.Equal(expected, ParseSingle(record).Level);
    }

    [Theory]
    [InlineData("warn", "Warning")]
    [InlineData("TRACE", "Verbose")]
    [InlineData("", "Information")]
    public void MissingSeverityNumber_FallsBackToSeverityText(string text, string expected)
    {
        var record = new LogRecord { TimeUnixNano = TenAm, SeverityText = text };
        Assert.Equal(expected, ParseSingle(record).Level);
    }

    [Theory]
    [InlineData(25, "warn", "Warning")]
    [InlineData(100, "", "Information")]
    public void SeverityNumberOutOfRange_FallsBackToSeverityText(int number, string text, string expected)
    {
        var record = new LogRecord
        {
            TimeUnixNano = TenAm,
            SeverityNumber = (SeverityNumber)number,
            SeverityText = text,
        };
        Assert.Equal(expected, ParseSingle(record).Level);
    }

    [Fact]
    public void TimeUnixNano_IsNormalizedToFixedUtcFormat()
    {
        var record = new LogRecord { TimeUnixNano = TenAm };
        Assert.Equal("2026-07-13T10:00:00.0000000Z", ParseSingle(record).Timestamp);
    }

    [Fact]
    public void ZeroTime_FallsBackToObservedTime_ThenServerTime()
    {
        var observed = new LogRecord { ObservedTimeUnixNano = TenAm };
        Assert.Equal("2026-07-13T10:00:00.0000000Z", ParseSingle(observed).Timestamp);

        var neither = new LogRecord();
        Assert.Equal("2026-07-13T12:00:00.0000000Z", ParseSingle(neither).Timestamp);
    }

    [Fact]
    public void FarFutureTime_IsClampedToServerTime()
    {
        // one hour past server time, well beyond the 5-minute tolerance
        var record = new LogRecord { TimeUnixNano = TenAm + 3 * 3_600_000_000_000UL };
        Assert.Equal("2026-07-13T12:00:00.0000000Z", ParseSingle(record).Timestamp);
    }

    [Fact]
    public void MaxUlongTime_YearBeyond2500_IsClampedToServerTime()
    {
        // ulong nanos saturate around year 2554 — far future, so the clamp catches it
        var record = new LogRecord { TimeUnixNano = ulong.MaxValue };
        Assert.Equal("2026-07-13T12:00:00.0000000Z", ParseSingle(record).Timestamp);
    }

    [Fact]
    public void StringBody_BecomesMessage()
    {
        var record = new LogRecord { TimeUnixNano = TenAm, Body = new AnyValue { StringValue = "hello otlp" } };
        Assert.Equal("hello otlp", ParseSingle(record).Message);
    }

    [Fact]
    public void StructuredBody_BecomesCompactJsonText()
    {
        var body = new AnyValue { KvlistValue = new KeyValueList() };
        body.KvlistValue.Values.Add(Attr("k", "v"));
        var record = new LogRecord { TimeUnixNano = TenAm, Body = body };
        Assert.Equal("""{"k":"v"}""", ParseSingle(record).Message);
    }

    [Fact]
    public void NonKvlistStructuredBody_BecomesCompactJsonText()
    {
        var body = new AnyValue { ArrayValue = new ArrayValue() };
        body.ArrayValue.Values.Add(new AnyValue { StringValue = "a" });
        body.ArrayValue.Values.Add(new AnyValue { IntValue = 1 });
        var record = new LogRecord { TimeUnixNano = TenAm, Body = body };
        Assert.Equal("""["a",1]""", ParseSingle(record).Message);
    }

    [Fact]
    public void TemplateAttribute_BecomesMessageTemplate_AndIsConsumed()
    {
        var record = new LogRecord { TimeUnixNano = TenAm, Body = new AnyValue { StringValue = "Order 42 failed" } };
        record.Attributes.Add(Attr("message_template.text", "Order {OrderId} failed"));
        record.Attributes.Add(Attr("message_template.hash.md5", "abc123"));
        record.Attributes.Add(new KeyValue { Key = "OrderId", Value = new AnyValue { IntValue = 42 } });

        var parsed = ParseSingle(record);

        Assert.Equal("Order {OrderId} failed", parsed.MessageTemplate);
        Assert.Equal("""{"OrderId":42}""", parsed.Properties);
    }

    [Fact]
    public void EmptyBody_FallsBackToTemplate()
    {
        var record = new LogRecord { TimeUnixNano = TenAm };
        record.Attributes.Add(Attr("message_template.text", "tick {N}"));
        Assert.Equal("tick {N}", ParseSingle(record).Message);
    }

    [Fact]
    public void TraceAndSpanIds_BecomeLowercaseHex()
    {
        var record = new LogRecord
        {
            TimeUnixNano = TenAm,
            TraceId = ByteString.CopyFrom(Convert.FromHexString("0AF7651916CD43DD8448EB211C80319C")),
            SpanId = ByteString.CopyFrom(Convert.FromHexString("B7AD6B7169203331")),
        };

        var parsed = ParseSingle(record);

        Assert.Equal("0af7651916cd43dd8448eb211c80319c", parsed.TraceId);
        Assert.Equal("b7ad6b7169203331", parsed.SpanId);
    }

    [Fact]
    public void InvalidIds_WrongLengthOrAllZero_BecomeNull()
    {
        var record = new LogRecord
        {
            TimeUnixNano = TenAm,
            TraceId = ByteString.CopyFrom([1, 2, 3]),               // wrong length
            SpanId = ByteString.CopyFrom(new byte[8]),              // all-zero = invalid per W3C
        };

        var parsed = ParseSingle(record);

        Assert.Null(parsed.TraceId);
        Assert.Null(parsed.SpanId);
    }

    [Fact]
    public void ResourceAttributes_Merge_RecordWinsOnCollision()
    {
        var record = new LogRecord { TimeUnixNano = TenAm };
        record.Attributes.Add(Attr("deployment.environment", "record-wins"));

        var parsed = ParseSingle(record,
            Attr("service.name", "checkout-api"),
            Attr("deployment.environment", "resource-loses"));

        Assert.Equal(
            """{"service.name":"checkout-api","deployment.environment":"record-wins"}""",
            parsed.Properties);
    }

    [Fact]
    public void ExceptionAttributes_ComposeExceptionColumn_AndAreConsumed()
    {
        var record = new LogRecord { TimeUnixNano = TenAm };
        record.Attributes.Add(Attr("exception.type", "System.InvalidOperationException"));
        record.Attributes.Add(Attr("exception.message", "boom"));
        record.Attributes.Add(Attr("exception.stacktrace", "   at Api.Do()"));

        var parsed = ParseSingle(record);

        Assert.Equal("System.InvalidOperationException: boom\n   at Api.Do()", parsed.Exception);
        Assert.Null(parsed.Properties);
    }

    [Theory]
    [InlineData("System.TimeoutException", null, null, "System.TimeoutException")]
    [InlineData(null, "boom", null, "boom")]
    [InlineData(null, null, "   at Api.Do()", "   at Api.Do()")]
    public void PartialExceptionAttributes_ComposeWhatIsPresent(
        string? type, string? message, string? stacktrace, string expected)
    {
        var record = new LogRecord { TimeUnixNano = TenAm };
        if (type is not null)
        {
            record.Attributes.Add(Attr("exception.type", type));
        }
        if (message is not null)
        {
            record.Attributes.Add(Attr("exception.message", message));
        }
        if (stacktrace is not null)
        {
            record.Attributes.Add(Attr("exception.stacktrace", stacktrace));
        }

        Assert.Equal(expected, ParseSingle(record).Exception);
    }

    [Fact]
    public void NoAttributes_YieldNullPropertiesAndException()
    {
        var record = new LogRecord { TimeUnixNano = TenAm };
        var parsed = ParseSingle(record);
        Assert.Null(parsed.Properties);
        Assert.Null(parsed.Exception);
    }

    [Fact]
    public void OversizedRecord_IsRejected_OthersSurvive()
    {
        var oversized = new LogRecord { TimeUnixNano = TenAm };
        oversized.Attributes.Add(Attr("blob", new string('x', MaxEventBytes + 1)));
        var normal = new LogRecord { TimeUnixNano = TenAm, Body = new AnyValue { StringValue = "kept" } };

        var request = Wrap(oversized);
        request.ResourceLogs[0].ScopeLogs[0].LogRecords.Add(normal);

        var result = OtlpLogParser.Parse(request, ServerTime, MaxEventBytes);

        Assert.Equal(1, result.RejectedLogRecords);
        Assert.Contains("MaxEventBytes", result.ErrorMessage);
        Assert.Equal("kept", Assert.Single(result.Events).Message);
    }

    [Fact]
    public void IngestedAt_IsServerTime()
    {
        var record = new LogRecord { TimeUnixNano = TenAm };
        Assert.Equal("2026-07-13T12:00:00.0000000Z", ParseSingle(record).IngestedAt);
    }
}
