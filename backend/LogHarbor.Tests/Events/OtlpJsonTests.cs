using LogHarbor.Core.Events.Otlp;

namespace LogHarbor.Tests.Events;

public sealed class OtlpJsonTests
{
    private const string HexTrace = "0af7651916cd43dd8448eb211c80319c";
    private const string HexSpan = "b7ad6b7169203331";

    // plain raw string + Replace: interpolated raw strings reject nested JSON's }} runs (CS9007)
    private static string Payload(string idFields) => """
        {"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"checkout"}}]},
        "scopeLogs":[{"logRecords":[{"timeUnixNano":"1783936800000000000","severityNumber":17,
        "body":{"stringValue":"boom"}__IDS__}]}]}]}
        """.Replace("__IDS__", idFields);

    [Fact]
    public void HexTraceIds_AreTranscoded_ForTheProtobufJsonParser()
    {
        var json = Payload($@",""traceId"":""{HexTrace}"",""spanId"":""{HexSpan}""");

        Assert.True(OtlpJson.TryParse(json, out var request, out var error), error);

        var record = request!.ResourceLogs[0].ScopeLogs[0].LogRecords[0];
        Assert.Equal(HexTrace, Convert.ToHexString(record.TraceId.ToByteArray()).ToLowerInvariant());
        Assert.Equal(HexSpan, Convert.ToHexString(record.SpanId.ToByteArray()).ToLowerInvariant());
        Assert.Equal("boom", record.Body.StringValue);
    }

    [Fact]
    public void SeverityNumber_AcceptsEnumNameStrings()
    {
        var json = """
            {"resourceLogs":[{"scopeLogs":[{"logRecords":[
            {"severityNumber":"SEVERITY_NUMBER_ERROR","body":{"stringValue":"x"}}]}]}]}
            """;

        Assert.True(OtlpJson.TryParse(json, out var request, out var error), error);
        Assert.Equal(17, (int)request!.ResourceLogs[0].ScopeLogs[0].LogRecords[0].SeverityNumber);
    }

    [Fact]
    public void SnakeCaseKeys_AreAccepted()
    {
        var json = """
            {"resource_logs":[{"scope_logs":[{"log_records":[
            {"trace_id":"__TRACE__","body":{"stringValue":"x"}}]}]}]}
            """.Replace("__TRACE__", HexTrace);

        Assert.True(OtlpJson.TryParse(json, out var request, out var error), error);
        var record = request!.ResourceLogs[0].ScopeLogs[0].LogRecords[0];
        Assert.Equal(HexTrace, Convert.ToHexString(record.TraceId.ToByteArray()).ToLowerInvariant());
    }

    [Fact]
    public void UnknownFields_AreIgnored()
    {
        var json = """
            {"resourceLogs":[{"scopeLogs":[{"logRecords":[
            {"body":{"stringValue":"x"},"someFutureField":123}]}]}]}
            """;

        Assert.True(OtlpJson.TryParse(json, out _, out var error), error);
    }

    [Theory]
    [InlineData("not json at all")]
    [InlineData("[1,2,3]")]
    public void MalformedPayload_Fails(string json)
    {
        Assert.False(OtlpJson.TryParse(json, out _, out var error));
        Assert.NotNull(error);
    }

    [Fact]
    public void NonHexTraceId_FailsWithFieldName()
    {
        var json = Payload(@",""traceId"":""zz-not-hex""");

        Assert.False(OtlpJson.TryParse(json, out _, out var error));
        Assert.Contains("traceId", error);
    }
}
