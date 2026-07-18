using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using LogHarbor.Core.Alerting;
using LogHarbor.Core.Events;
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

    /// <summary>A signal on Error events and a silence rule over it; returns (signalId, createdAt).</summary>
    private async Task<(long SignalId, DateTimeOffset CreatedAt)> ArrangeSilenceRuleAsync(int windowMinutes = 5)
    {
        var signal = await _client.PostAsJsonAsync(
            "/api/signals", new { title = "errors", filter = "@Level = 'Error'" });
        Assert.Equal(HttpStatusCode.Created, signal.StatusCode);
        var signalId = (await signal.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();

        var alert = await _client.PostAsJsonAsync("/api/alerts", new
        {
            title = "dead-cron",
            signalId,
            thresholdCount = 0,
            windowMinutes,
            webhookUrl = "https://example.com/hook",
            isEnabled = true,
            condition = "silence",
        });
        Assert.Equal(HttpStatusCode.Created, alert.StatusCode);
        var createdAt = DateTimeOffset.Parse(
            (await alert.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("createdAt").GetString()!);
        return (signalId, createdAt);
    }

    private async Task SeedErrorAtAsync(DateTimeOffset when)
    {
        var events = _factory.Services.GetRequiredService<IEventStore>();
        var ts = ClefParser.FormatTimestamp(when);
        await events.WriteBatchAsync([new Event(0, ts, "Error", "boom", null, null, null, ts)]);
    }

    private AlertEvaluator NewEvaluator() => new(
        _factory.Services.GetRequiredService<IAlertStore>(),
        _factory.Services.GetRequiredService<IEventStore>(),
        _sender);

    [Fact]
    public async Task Silence_FiresWhenAOnceAliveSignalGoesQuiet()
    {
        var (_, createdAt) = await ArrangeSilenceRuleAsync(windowMinutes: 5);
        // proof of life 30s after creation; well before the silence window
        await SeedErrorAtAsync(createdAt.AddSeconds(30));

        // now = createdAt + 6 min: silence window (createdAt+1m, createdAt+6m) is empty,
        // proof window (createdAt, createdAt+1m) holds the seeded event
        var fired = await NewEvaluator().EvaluateAsync(createdAt.AddMinutes(6));

        Assert.Equal(1, fired);
        var (_, payload) = Assert.Single(_sender.Sent);
        var json = JsonSerializer.Deserialize<JsonElement>(payload);
        Assert.Equal("silence", json.GetProperty("condition").GetString());
        Assert.Equal(0, json.GetProperty("count").GetInt64());
    }

    [Fact]
    public async Task Silence_DoesNotFireWithoutProofOfLife()
    {
        var (_, createdAt) = await ArrangeSilenceRuleAsync(windowMinutes: 5);
        // no event ever matched the signal

        var fired = await NewEvaluator().EvaluateAsync(createdAt.AddMinutes(6));

        Assert.Equal(0, fired);
        Assert.Empty(_sender.Sent);
    }

    [Fact]
    public async Task Silence_DoesNotFireWhenTheWindowHasEvents()
    {
        var (_, createdAt) = await ArrangeSilenceRuleAsync(windowMinutes: 5);
        await SeedErrorAtAsync(createdAt.AddSeconds(30));       // proof of life
        await SeedErrorAtAsync(createdAt.AddMinutes(5).AddSeconds(30)); // inside the silence window

        var fired = await NewEvaluator().EvaluateAsync(createdAt.AddMinutes(6));

        Assert.Equal(0, fired);
        Assert.Empty(_sender.Sent);
    }

    [Fact]
    public async Task Silence_RespectsTheOneWindowCooldown()
    {
        var (_, createdAt) = await ArrangeSilenceRuleAsync(windowMinutes: 5);
        await SeedErrorAtAsync(createdAt.AddSeconds(30));

        Assert.Equal(1, await NewEvaluator().EvaluateAsync(createdAt.AddMinutes(6)));
        // one minute later, still within the cooldown window since the last firing
        Assert.Equal(0, await NewEvaluator().EvaluateAsync(createdAt.AddMinutes(7)));
    }
}
