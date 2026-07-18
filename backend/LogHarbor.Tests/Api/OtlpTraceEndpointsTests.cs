using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Google.Protobuf;
using Microsoft.Extensions.DependencyInjection;
using OpenTelemetry.Proto.Collector.Trace.V1;
using OpenTelemetry.Proto.Trace.V1;

namespace LogHarbor.Tests.Api;

// ISpanStore is fully qualified below: importing LogHarbor.Core.Storage here would make the
// bare name `Span` ambiguous against OpenTelemetry.Proto.Trace.V1.Span.
public sealed class OtlpTraceEndpointsTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public OtlpTraceEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private const string HexTrace = "0af7651916cd43dd8448eb211c80319c";
    private const string HexSpan = "b7ad6b7169203331";

    private async Task<string> CreateApiKeyAsync()
    {
        var response = await _client.PostAsJsonAsync("/api/apikeys", new { title = "traces" });
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
    }

    private static ExportTraceServiceRequest OneSpan(string name)
    {
        var span = new Span
        {
            TraceId = ByteString.CopyFrom(Convert.FromHexString(HexTrace)),
            SpanId = ByteString.CopyFrom(Convert.FromHexString(HexSpan)),
            Name = name,
            StartTimeUnixNano = 1_000_000_000,
            EndTimeUnixNano = 1_050_000_000,
        };
        var scope = new ScopeSpans();
        scope.Spans.Add(span);
        var resourceSpans = new ResourceSpans();
        resourceSpans.ScopeSpans.Add(scope);
        var request = new ExportTraceServiceRequest();
        request.ResourceSpans.Add(resourceSpans);
        return request;
    }

    [Fact]
    public async Task Protobuf_IngestsSpans_AndPersistsThem()
    {
        var token = await CreateApiKeyAsync();
        var message = new HttpRequestMessage(HttpMethod.Post, "/v1/traces")
        {
            Content = new ByteArrayContent(OneSpan("GET /cart").ToByteArray()),
        };
        message.Content.Headers.ContentType = new MediaTypeHeaderValue("application/x-protobuf");
        message.Headers.Add("X-LogHarbor-ApiKey", token);

        Assert.Equal(HttpStatusCode.OK, (await _client.SendAsync(message)).StatusCode);

        var spans = await _factory.Services
            .GetRequiredService<LogHarbor.Core.Storage.ISpanStore>().GetTraceAsync(HexTrace);
        Assert.Equal("GET /cart", Assert.Single(spans).Name);
    }

    [Fact]
    public async Task Json_IngestsSpans()
    {
        var token = await CreateApiKeyAsync();
        var json = $$"""
        {"resourceSpans":[{"scopeSpans":[{"spans":[
          {"traceId":"{{HexTrace}}","spanId":"{{HexSpan}}","name":"json-span",
           "startTimeUnixNano":"1000000000","endTimeUnixNano":"1050000000"}]}]}]}
        """;
        var message = new HttpRequestMessage(HttpMethod.Post, "/v1/traces")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        message.Headers.Add("X-LogHarbor-ApiKey", token);

        Assert.Equal(HttpStatusCode.OK, (await _client.SendAsync(message)).StatusCode);
        var spans = await _factory.Services
            .GetRequiredService<LogHarbor.Core.Storage.ISpanStore>().GetTraceAsync(HexTrace);
        Assert.Equal("json-span", Assert.Single(spans).Name);
    }

    [Fact]
    public async Task WrongContentType_Is415()
    {
        var token = await CreateApiKeyAsync();
        var message = new HttpRequestMessage(HttpMethod.Post, "/v1/traces")
        {
            Content = new StringContent("hi", Encoding.UTF8, "text/plain"),
        };
        message.Headers.Add("X-LogHarbor-ApiKey", token);

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await _client.SendAsync(message)).StatusCode);
    }
}
