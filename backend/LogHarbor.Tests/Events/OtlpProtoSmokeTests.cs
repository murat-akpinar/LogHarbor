using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Logs.V1;
using OpenTelemetry.Proto.Logs.V1;

namespace LogHarbor.Tests.Events;

public sealed class OtlpProtoSmokeTests
{
    [Fact]
    public void GeneratedTypes_RoundTripThroughProtobuf()
    {
        var request = new ExportLogsServiceRequest();
        var resourceLogs = new ResourceLogs();
        resourceLogs.ScopeLogs.Add(new ScopeLogs());
        request.ResourceLogs.Add(resourceLogs);

        var parsed = ExportLogsServiceRequest.Parser.ParseFrom(request.ToByteArray());

        Assert.Single(parsed.ResourceLogs);
        Assert.Single(parsed.ResourceLogs[0].ScopeLogs);
    }
}
