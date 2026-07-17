using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Google.Protobuf;
using Microsoft.AspNetCore.SignalR.Client;
using OpenTelemetry.Proto.Collector.Logs.V1;
using OpenTelemetry.Proto.Common.V1;
using OpenTelemetry.Proto.Logs.V1;
using LogHarbor.Core.Events;
using OtlpResource = OpenTelemetry.Proto.Resource.V1.Resource;

namespace LogHarbor.Tests.Api;

public sealed class OtlpEndpointsTests : IAsyncLifetime
{
    private const string HexTrace = "0af7651916cd43dd8448eb211c80319c";

    // 2026-07-13T10:00:00Z in unix nanoseconds
    private const ulong TenAm = 1_783_936_800_000_000_000UL;

    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;
    private readonly List<HubConnection> _connections = [];

    public OtlpEndpointsTests() => _client = _factory.CreateClient();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var connection in _connections)
        {
            await connection.DisposeAsync();
        }
        _factory.Dispose();
    }

    private async Task<string> CreateApiKeyAsync()
    {
        var response = await _client.PostAsJsonAsync("/api/apikeys", new { title = "otlp" });
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        return created.GetProperty("token").GetString()!;
    }

    private Task<HttpResponseMessage> PostOtlpAsync(byte[] body, string contentType, string? apiKey)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/v1/logs")
        {
            Content = new ByteArrayContent(body),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        if (apiKey is not null)
        {
            request.Headers.Add("X-LogHarbor-ApiKey", apiKey);
        }
        return _client.SendAsync(request);
    }

    private static KeyValue Attr(string key, string value) =>
        new() { Key = key, Value = new AnyValue { StringValue = value } };

    private static ExportLogsServiceRequest BuildRequest(params LogRecord[] records)
    {
        var resourceLogs = new ResourceLogs { Resource = new OtlpResource() };
        resourceLogs.Resource.Attributes.Add(Attr("service.name", "checkout-api"));
        var scope = new ScopeLogs();
        scope.LogRecords.AddRange(records);
        resourceLogs.ScopeLogs.Add(scope);
        var request = new ExportLogsServiceRequest();
        request.ResourceLogs.Add(resourceLogs);
        return request;
    }

    [Fact]
    public async Task MissingApiKey_Returns401()
    {
        var response = await PostOtlpAsync(
            BuildRequest(new LogRecord()).ToByteArray(), "application/x-protobuf", apiKey: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ProtobufBatch_IsStored_AndQueryableByDottedProperty()
    {
        var token = await CreateApiKeyAsync();
        var record = new LogRecord
        {
            TimeUnixNano = TenAm,
            SeverityNumber = (SeverityNumber)17,
            Body = new AnyValue { StringValue = "otlp boom" },
            TraceId = ByteString.CopyFrom(Convert.FromHexString(HexTrace)),
        };

        var response = await PostOtlpAsync(BuildRequest(record).ToByteArray(), "application/x-protobuf", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/x-protobuf", response.Content.Headers.ContentType!.MediaType);
        var export = ExportLogsServiceResponse.Parser.ParseFrom(await response.Content.ReadAsByteArrayAsync());
        Assert.Null(export.PartialSuccess);

        var page = await _client.GetFromJsonAsync<JsonElement>(
            "/api/events?filter=" + Uri.EscapeDataString("service.name = 'checkout-api'"));
        var matched = page.GetProperty("events").EnumerateArray().Single();
        Assert.Equal("otlp boom", matched.GetProperty("message").GetString());
        Assert.Equal("Error", matched.GetProperty("level").GetString());
        Assert.Equal(HexTrace, matched.GetProperty("traceId").GetString());
    }

    [Fact]
    public async Task JsonBatch_WithHexTraceIds_IsStored()
    {
        var token = await CreateApiKeyAsync();
        var json = $$"""
            {"resourceLogs":[{"scopeLogs":[{"logRecords":[
            {"timeUnixNano":"{{TenAm}}","severityNumber":"SEVERITY_NUMBER_WARN",
            "body":{"stringValue":"json otlp"},"traceId":"{{HexTrace}}"}]}]}]}
            """;

        var response = await PostOtlpAsync(Encoding.UTF8.GetBytes(json), "application/json", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType!.MediaType);

        var page = await _client.GetFromJsonAsync<JsonElement>(
            "/api/events?filter=" + Uri.EscapeDataString($"@TraceId = '{HexTrace}'"));
        var matched = page.GetProperty("events").EnumerateArray().Single();
        Assert.Equal("json otlp", matched.GetProperty("message").GetString());
        Assert.Equal("Warning", matched.GetProperty("level").GetString());
    }

    [Fact]
    public async Task OversizedRecord_IsSkipped_AndReportedInPartialSuccess()
    {
        var token = await CreateApiKeyAsync();
        var oversized = new LogRecord { TimeUnixNano = TenAm };
        // over the factory's per-event cap while the whole batch stays under its batch cap
        oversized.Attributes.Add(Attr("blob", new string('x', LogHarborApiFactory.MaxEventBytes + 1)));
        var normal = new LogRecord { TimeUnixNano = TenAm, Body = new AnyValue { StringValue = "kept" } };

        var response = await PostOtlpAsync(
            BuildRequest(oversized, normal).ToByteArray(), "application/x-protobuf", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var export = ExportLogsServiceResponse.Parser.ParseFrom(await response.Content.ReadAsByteArrayAsync());
        Assert.Equal(1, export.PartialSuccess.RejectedLogRecords);
        Assert.Contains("MaxEventBytes", export.PartialSuccess.ErrorMessage);

        var page = await _client.GetFromJsonAsync<JsonElement>("/api/events");
        Assert.Equal(1, page.GetProperty("events").GetArrayLength());
    }

    [Fact]
    public async Task UnsupportedContentType_Returns415()
    {
        var token = await CreateApiKeyAsync();
        var response = await PostOtlpAsync([1, 2, 3], "text/plain", token);

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
    }

    [Fact]
    public async Task MalformedProtobuf_Returns400()
    {
        var token = await CreateApiKeyAsync();
        var response = await PostOtlpAsync([0xFF, 0xFF, 0xFF, 0xFF], "application/x-protobuf", token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task BatchOverMaxBatchBytes_Returns413()
    {
        var token = await CreateApiKeyAsync();
        var record = new LogRecord { TimeUnixNano = TenAm };
        record.Attributes.Add(Attr("blob", new string('x', LogHarborApiFactory.MaxBatchBytes)));

        var response = await PostOtlpAsync(BuildRequest(record).ToByteArray(), "application/x-protobuf", token);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    public async Task UnknownV1Path_Returns404_NotTheSpa()
    {
        var token = await CreateApiKeyAsync();
        var response = await PostOtlpAsync(
            BuildRequest(new LogRecord()).ToByteArray(), "application/x-protobuf", token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var request = new HttpRequestMessage(HttpMethod.Post, "/v1/traces")
        {
            Content = new ByteArrayContent([]),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/x-protobuf");
        request.Headers.Add("X-LogHarbor-ApiKey", token);
        var traces = await _client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, traces.StatusCode);
    }

    [Fact]
    public async Task LiveTail_ReceivesOtlpEvents_MatchingFilter()
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(
                new Uri(_factory.Server.BaseAddress, "hubs/tail"),
                options => options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler())
            .Build();
        _connections.Add(connection);
        var batches = Channel.CreateUnbounded<IReadOnlyList<Event>>();
        connection.On<IReadOnlyList<Event>>("EventsArrived", events => batches.Writer.TryWrite(events));
        await connection.StartAsync();
        await connection.InvokeAsync("Subscribe", "@Level = 'Error'");

        var token = await CreateApiKeyAsync();
        var record = new LogRecord
        {
            TimeUnixNano = TenAm,
            SeverityNumber = (SeverityNumber)17,
            Body = new AnyValue { StringValue = "tail me" },
        };
        (await PostOtlpAsync(BuildRequest(record).ToByteArray(), "application/x-protobuf", token))
            .EnsureSuccessStatusCode();

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var received = await batches.Reader.ReadAsync(timeout.Token);
        Assert.Equal("tail me", Assert.Single(received).Message);
    }
}
