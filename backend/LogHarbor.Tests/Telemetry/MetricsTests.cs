using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Google.Protobuf;
using Microsoft.Extensions.DependencyInjection;
using OpenTelemetry.Metrics;
using OpenTelemetry.Proto.Collector.Logs.V1;
using OpenTelemetry.Proto.Common.V1;
using OpenTelemetry.Proto.Logs.V1;
using LogHarbor.Tests.Api;

namespace LogHarbor.Tests.Telemetry;

public sealed class MetricsTests : IDisposable
{
    private readonly List<LogHarborApiFactory> _factories = [];
    private readonly LogHarborApiFactory _factory;
    private readonly HttpClient _client;

    public MetricsTests()
    {
        _factory = NewFactory();
        _client = _factory.CreateClient();
    }

    private LogHarborApiFactory NewFactory(string? otlpMetricsEndpoint = null)
    {
        var factory = new LogHarborApiFactory(otlpMetricsEndpoint: otlpMetricsEndpoint);
        _factories.Add(factory);
        return factory;
    }

    public void Dispose()
    {
        foreach (var factory in _factories)
        {
            factory.Dispose();
        }
    }

    private async Task<string> CreateApiKeyAsync()
    {
        var response = await _client.PostAsJsonAsync("/api/apikeys", new { title = "metrics" });
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
    }

    [Fact]
    public async Task ClefIngest_CountsStoredEvents_TaggedClef()
    {
        var token = await CreateApiKeyAsync();
        // 7 is the distinctive batch size this test owns; the meter is process-global
        var lines = string.Join("\n", Enumerable.Range(0, 7).Select(i =>
            $$"""{"@t":"2026-07-13T10:00:00Z","@m":"metric {{i}}"}"""));
        using var capture = new MeterCapture();

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw")
        {
            Content = new StringContent(lines, Encoding.UTF8, "application/vnd.serilog.clef"),
        };
        request.Headers.Add("X-LogHarbor-ApiKey", token);
        Assert.Equal(HttpStatusCode.Created, (await _client.SendAsync(request)).StatusCode);

        Assert.Contains(capture.Measurements,
            m => m.Instrument == "logharbor.ingest.events" && m.Value == 7 && m.Source == "clef");
    }

    [Fact]
    public async Task OtlpIngest_CountsStoredEvents_TaggedOtlp()
    {
        var token = await CreateApiKeyAsync();
        var scope = new ScopeLogs();
        for (var i = 0; i < 5; i++)
        {
            scope.LogRecords.Add(new LogRecord
            {
                Body = new AnyValue { StringValue = $"metric {i}" },
            });
        }
        var resourceLogs = new ResourceLogs();
        resourceLogs.ScopeLogs.Add(scope);
        var export = new ExportLogsServiceRequest();
        export.ResourceLogs.Add(resourceLogs);
        using var capture = new MeterCapture();

        var request = new HttpRequestMessage(HttpMethod.Post, "/v1/logs")
        {
            Content = new ByteArrayContent(export.ToByteArray()),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/x-protobuf");
        request.Headers.Add("X-LogHarbor-ApiKey", token);
        Assert.Equal(HttpStatusCode.OK, (await _client.SendAsync(request)).StatusCode);

        Assert.Contains(capture.Measurements,
            m => m.Instrument == "logharbor.ingest.events" && m.Value == 5 && m.Source == "otlp");
    }

    [Fact]
    public async Task Ingest_RecordsDurationPerSource()
    {
        var token = await CreateApiKeyAsync();
        using var capture = new MeterCapture();

        var clef = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw")
        {
            Content = new StringContent(
                """{"@t":"2026-07-13T10:00:00Z","@m":"timed"}""",
                Encoding.UTF8, "application/vnd.serilog.clef"),
        };
        clef.Headers.Add("X-LogHarbor-ApiKey", token);
        Assert.Equal(HttpStatusCode.Created, (await _client.SendAsync(clef)).StatusCode);

        var scope = new ScopeLogs();
        scope.LogRecords.Add(new LogRecord { Body = new AnyValue { StringValue = "timed" } });
        var resourceLogs = new ResourceLogs();
        resourceLogs.ScopeLogs.Add(scope);
        var export = new ExportLogsServiceRequest();
        export.ResourceLogs.Add(resourceLogs);
        var otlp = new HttpRequestMessage(HttpMethod.Post, "/v1/logs")
        {
            Content = new ByteArrayContent(export.ToByteArray()),
        };
        otlp.Content.Headers.ContentType = new MediaTypeHeaderValue("application/x-protobuf");
        otlp.Headers.Add("X-LogHarbor-ApiKey", token);
        Assert.Equal(HttpStatusCode.OK, (await _client.SendAsync(otlp)).StatusCode);

        Assert.Contains(capture.Measurements,
            m => m.Instrument == "logharbor.ingest.duration" && m.Value >= 0 && m.Source == "clef");
        Assert.Contains(capture.Measurements,
            m => m.Instrument == "logharbor.ingest.duration" && m.Value >= 0 && m.Source == "otlp");
    }

    [Fact]
    public async Task EventSearch_RecordsQueryDuration()
    {
        using var capture = new MeterCapture();

        var response = await _client.GetAsync("/api/events");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(capture.Measurements,
            m => m.Instrument == "logharbor.query.duration" && m.Value >= 0);
    }

    [Fact]
    public void MeterProvider_IsRegistered_OnlyWhenOtlpEndpointIsSet()
    {
        Assert.Null(_factory.Services.GetService<MeterProvider>());

        var exporting = NewFactory(otlpMetricsEndpoint: "http://localhost:9009");
        Assert.NotNull(exporting.Services.GetService<MeterProvider>());
    }
}
