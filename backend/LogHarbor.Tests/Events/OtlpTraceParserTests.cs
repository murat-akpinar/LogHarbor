using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Trace.V1;
using OpenTelemetry.Proto.Common.V1;
using OpenTelemetry.Proto.Resource.V1;
using OpenTelemetry.Proto.Trace.V1;
using LogHarbor.Core.Events.Otlp;

namespace LogHarbor.Tests.Events;

public class OtlpTraceParserTests
{
    private const string HexTrace = "0af7651916cd43dd8448eb211c80319c";
    private const string HexSpan = "b7ad6b7169203331";
    private const string HexParent = "1111222233334444";

    private static ExportTraceServiceRequest Request(Span span, string? serviceName = "checkout")
    {
        var scope = new ScopeSpans();
        scope.Spans.Add(span);
        var resourceSpans = new ResourceSpans();
        resourceSpans.ScopeSpans.Add(scope);
        if (serviceName is not null)
        {
            resourceSpans.Resource = new Resource();
            resourceSpans.Resource.Attributes.Add(
                new KeyValue { Key = "service.name", Value = new AnyValue { StringValue = serviceName } });
        }
        var request = new ExportTraceServiceRequest();
        request.ResourceSpans.Add(resourceSpans);
        return request;
    }

    [Fact]
    public void Span_IsMapped_WithServiceKindStatusAndDuration()
    {
        var span = new Span
        {
            TraceId = ByteString.CopyFrom(Convert.FromHexString(HexTrace)),
            SpanId = ByteString.CopyFrom(Convert.FromHexString(HexSpan)),
            ParentSpanId = ByteString.CopyFrom(Convert.FromHexString(HexParent)),
            Name = "GET /cart",
            Kind = Span.Types.SpanKind.Server,
            StartTimeUnixNano = 1_000_000_000,   // 1s after epoch
            EndTimeUnixNano = 1_150_000_000,      // +150ms
            Status = new Status { Code = Status.Types.StatusCode.Error, Message = "boom" },
        };
        span.Attributes.Add(new KeyValue { Key = "http.method", Value = new AnyValue { StringValue = "GET" } });

        var result = OtlpTraceParser.Parse(Request(span), DateTimeOffset.UtcNow, maxSpanBytes: 262144);

        var mapped = Assert.Single(result.Spans);
        Assert.Equal(HexTrace, mapped.TraceId);
        Assert.Equal(HexSpan, mapped.SpanId);
        Assert.Equal(HexParent, mapped.ParentSpanId);
        Assert.Equal("GET /cart", mapped.Name);
        Assert.Equal("server", mapped.Kind);
        Assert.Equal("checkout", mapped.Service);
        Assert.Equal(150d, mapped.DurationMs);
        Assert.Equal("error", mapped.StatusCode);
        Assert.Equal("boom", mapped.StatusMessage);
        Assert.Contains("http.method", mapped.Attributes);
        Assert.Equal(0, result.RejectedSpans);
    }

    [Fact]
    public void RootSpan_HasNullParent_AndDefaults()
    {
        var span = new Span
        {
            TraceId = ByteString.CopyFrom(Convert.FromHexString(HexTrace)),
            SpanId = ByteString.CopyFrom(Convert.FromHexString(HexSpan)),
            Name = "root",
            StartTimeUnixNano = 1_000_000_000,
            EndTimeUnixNano = 1_000_000_000,
        };

        var mapped = Assert.Single(OtlpTraceParser.Parse(Request(span), DateTimeOffset.UtcNow, 262144).Spans);
        Assert.Null(mapped.ParentSpanId);
        Assert.Equal(0d, mapped.DurationMs);
        Assert.Equal("unspecified", mapped.Kind);
        Assert.Equal("unset", mapped.StatusCode);
        Assert.Null(mapped.StatusMessage);
    }

    [Fact]
    public void SpanWithBadId_IsRejected_AndCounted()
    {
        var span = new Span
        {
            TraceId = ByteString.CopyFrom(new byte[] { 1, 2, 3 }), // wrong length
            SpanId = ByteString.CopyFrom(Convert.FromHexString(HexSpan)),
            Name = "bad",
        };

        var result = OtlpTraceParser.Parse(Request(span, serviceName: null), DateTimeOffset.UtcNow, 262144);
        Assert.Empty(result.Spans);
        Assert.Equal(1, result.RejectedSpans);
    }
}
