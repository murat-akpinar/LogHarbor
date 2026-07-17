using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using LogHarbor.Core.Alerting;
using LogHarbor.Core.Storage;
using LogHarbor.Tests.Api;

namespace LogHarbor.Tests.Alerting;

public sealed class AlertEvaluatorTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;
    private readonly RecordingWebhookSender _sender = new();

    public AlertEvaluatorTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private sealed class RecordingWebhookSender : IWebhookSender
    {
        public List<(string Url, string Payload)> Sent { get; } = [];

        public Task<string?> SendAsync(string url, string jsonPayload, CancellationToken cancellationToken = default)
        {
            Sent.Add((url, jsonPayload));
            return Task.FromResult<string?>(null);
        }
    }

    /// <summary>One Error event, one signal matching it, one enabled rule with the given format.</summary>
    private async Task ArrangeFiringRuleAsync(string payloadFormat)
    {
        var keyResponse = await _client.PostAsJsonAsync("/api/apikeys", new { title = "alerts" });
        var token = (await keyResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
        var ingest = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw")
        {
            Content = new StringContent(
                $$"""{"@t":"{{DateTimeOffset.UtcNow:yyyy-MM-ddTHH:mm:ssZ}}","@l":"Error","@m":"boom"}""",
                Encoding.UTF8, "application/vnd.serilog.clef"),
        };
        ingest.Headers.Add("X-LogHarbor-ApiKey", token);
        Assert.Equal(HttpStatusCode.Created, (await _client.SendAsync(ingest)).StatusCode);

        var signal = await _client.PostAsJsonAsync(
            "/api/signals", new { title = "errors", filter = "@Level = 'Error'" });
        Assert.Equal(HttpStatusCode.Created, signal.StatusCode);
        var signalId = (await signal.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();

        var alert = await _client.PostAsJsonAsync("/api/alerts", new
        {
            title = "boom-rule",
            signalId,
            thresholdCount = 1,
            windowMinutes = 5,
            webhookUrl = "https://example.com/hook",
            isEnabled = true,
            payloadFormat,
        });
        Assert.Equal(HttpStatusCode.Created, alert.StatusCode);
    }

    private async Task<JsonElement> EvaluateAndReadPayloadAsync()
    {
        var evaluator = new AlertEvaluator(
            _factory.Services.GetRequiredService<IAlertStore>(),
            _factory.Services.GetRequiredService<IEventStore>(),
            _sender);
        Assert.Equal(1, await evaluator.EvaluateAsync(DateTimeOffset.UtcNow));
        var (url, payload) = Assert.Single(_sender.Sent);
        Assert.Equal("https://example.com/hook", url);
        return JsonSerializer.Deserialize<JsonElement>(payload);
    }

    [Fact]
    public async Task SlackFormat_SendsATextPayload()
    {
        await ArrangeFiringRuleAsync("slack");

        var payload = await EvaluateAndReadPayloadAsync();

        var text = Assert.Single(payload.EnumerateObject()).Value.GetString();
        Assert.Equal("text", Assert.Single(payload.EnumerateObject()).Name);
        Assert.Contains("boom-rule", text);
        Assert.Contains("errors", text);
        Assert.Contains("1 events", text);
    }

    [Fact]
    public async Task DiscordFormat_SendsAContentPayload()
    {
        await ArrangeFiringRuleAsync("discord");

        var payload = await EvaluateAndReadPayloadAsync();

        Assert.Equal("content", Assert.Single(payload.EnumerateObject()).Name);
        Assert.Contains("boom-rule", Assert.Single(payload.EnumerateObject()).Value.GetString());
    }

    [Fact]
    public async Task GenericFormat_KeepsTheStructuredPayload()
    {
        await ArrangeFiringRuleAsync("generic");

        var payload = await EvaluateAndReadPayloadAsync();

        Assert.Equal("boom-rule", payload.GetProperty("rule").GetString());
        Assert.Equal("errors", payload.GetProperty("signal").GetString());
        Assert.Equal("@Level = 'Error'", payload.GetProperty("filter").GetString());
        Assert.Equal(1, payload.GetProperty("count").GetInt64());
        Assert.Equal(1, payload.GetProperty("threshold").GetInt32());
        Assert.Equal(5, payload.GetProperty("windowMinutes").GetInt32());
    }
}
