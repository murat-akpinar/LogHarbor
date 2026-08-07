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

/// <summary>
/// Acknowledging an alarm: it fires, somebody says they know, and it stops paging until the
/// silence expires — without the rule being switched off and forgotten.
/// </summary>
public sealed class AlertAcknowledgeTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;
    private readonly CountingWebhookSender _sender = new();

    public AlertAcknowledgeTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private sealed class CountingWebhookSender : IWebhookSender
    {
        public int Sent { get; private set; }

        public Task<string?> SendAsync(string url, string payload, CancellationToken cancellationToken = default)
        {
            Sent++;
            return Task.FromResult<string?>(null);
        }
    }

    /// <summary>One Error event, a signal over it, and an enabled rule that fires on the first.</summary>
    private async Task<long> ArrangeFiringRuleAsync(int windowMinutes = 5)
    {
        var keyResponse = await _client.PostAsJsonAsync("/api/apikeys", new { title = "ack" });
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
        var signalId = (await signal.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();

        var alert = await _client.PostAsJsonAsync("/api/alerts", new
        {
            title = "boom-rule",
            signalId,
            thresholdCount = 1,
            windowMinutes,
            webhookUrl = "https://example.com/hook",
            isEnabled = true,
        });
        Assert.Equal(HttpStatusCode.Created, alert.StatusCode);
        return (await alert.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();
    }

    private AlertEvaluator NewEvaluator() => new(
        _factory.Services.GetRequiredService<IAlertStore>(),
        _factory.Services.GetRequiredService<IEventStore>(),
        _sender);

    [Fact]
    public async Task Unacknowledged_ReadsBackAsNothing()
    {
        await ArrangeFiringRuleAsync();

        var rule = (await _client.GetFromJsonAsync<JsonElement>("/api/alerts")).EnumerateArray().Single();

        Assert.Equal(JsonValueKind.Null, rule.GetProperty("acknowledgedUntil").ValueKind);
        Assert.Equal(JsonValueKind.Null, rule.GetProperty("acknowledgedBy").ValueKind);
    }

    [Fact]
    public async Task Acknowledged_StopsTheWebhookWhileItLasts()
    {
        var id = await ArrangeFiringRuleAsync();
        var acknowledge = await _client.PostAsJsonAsync($"/api/alerts/{id}/acknowledge", new { minutes = 60 });
        Assert.Equal(HttpStatusCode.OK, acknowledge.StatusCode);

        Assert.Equal(0, await NewEvaluator().EvaluateAsync(DateTimeOffset.UtcNow));
        Assert.Equal(0, _sender.Sent);
    }

    /// <summary>The difference between acknowledging and disabling: the rule is untouched, so
    /// the moment the silence runs out it fires again if the condition still holds.</summary>
    [Fact]
    public async Task Acknowledged_FiresAgainOnceTheSilenceExpires()
    {
        // a two-hour window, so the event that makes the rule fire is still inside it when the
        // acknowledgement runs out -- the window is measured back from the evaluation instant
        var id = await ArrangeFiringRuleAsync(windowMinutes: 120);
        await _client.PostAsJsonAsync($"/api/alerts/{id}/acknowledge", new { minutes = 30 });

        Assert.Equal(0, await NewEvaluator().EvaluateAsync(DateTimeOffset.UtcNow));
        Assert.Equal(1, await NewEvaluator().EvaluateAsync(DateTimeOffset.UtcNow.AddMinutes(31)));
        Assert.Equal(1, _sender.Sent);
    }

    [Fact]
    public async Task Acknowledged_LeavesTheRuleEnabled()
    {
        var id = await ArrangeFiringRuleAsync();
        await _client.PostAsJsonAsync($"/api/alerts/{id}/acknowledge", new { minutes = 60 });

        var rule = (await _client.GetFromJsonAsync<JsonElement>("/api/alerts")).EnumerateArray().Single();

        Assert.True(rule.GetProperty("isEnabled").GetBoolean());
        Assert.NotNull(rule.GetProperty("acknowledgedUntil").GetString());
        // no session in this test host, so there is no name to record rather than a made-up one
        Assert.Equal(JsonValueKind.Null, rule.GetProperty("acknowledgedBy").ValueKind);
    }

    [Fact]
    public async Task Resumed_FiresAgainImmediately()
    {
        var id = await ArrangeFiringRuleAsync();
        await _client.PostAsJsonAsync($"/api/alerts/{id}/acknowledge", new { minutes = 60 });
        Assert.Equal(0, await NewEvaluator().EvaluateAsync(DateTimeOffset.UtcNow));

        var resumed = await _client.DeleteAsync($"/api/alerts/{id}/acknowledge");
        Assert.Equal(HttpStatusCode.OK, resumed.StatusCode);
        Assert.Equal(JsonValueKind.Null,
            (await resumed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("acknowledgedUntil").ValueKind);

        Assert.Equal(1, await NewEvaluator().EvaluateAsync(DateTimeOffset.UtcNow));
    }

    /// <summary>A silence rule (dead man's switch) is acknowledged by the same lever — it is the
    /// one an operator most wants to silence, because a quiet service stays quiet.</summary>
    [Fact]
    public async Task Acknowledged_SilencesASilenceRuleToo()
    {
        var signal = await _client.PostAsJsonAsync(
            "/api/signals", new { title = "heartbeat", filter = "@Level = 'Information'" });
        var signalId = (await signal.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();
        var alert = await _client.PostAsJsonAsync("/api/alerts", new
        {
            title = "heartbeat-gone",
            signalId,
            thresholdCount = 0,
            windowMinutes = 5,
            webhookUrl = "https://example.com/hook",
            isEnabled = true,
            condition = "silence",
        });
        var created = await alert.Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt64();
        var createdAt = DateTimeOffset.Parse(created.GetProperty("createdAt").GetString()!);

        // proof of life just after the rule was created, then nothing: a silence rule fires only
        // for a signal it has seen alive itself
        var events = _factory.Services.GetRequiredService<IEventStore>();
        var stamp = ClefParser.FormatTimestamp(createdAt.AddSeconds(30));
        await events.WriteBatchAsync([new Event(0, stamp, "Information", "alive", null, null, null, stamp)]);

        // six minutes on, the five-minute window is empty and the rule would fire
        Assert.Equal(1, await NewEvaluator().EvaluateAsync(createdAt.AddMinutes(6)));

        await _client.PostAsJsonAsync($"/api/alerts/{id}/acknowledge", new { minutes = 60 });
        Assert.Equal(0, await NewEvaluator().EvaluateAsync(createdAt.AddMinutes(12)));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(10081)] // one minute past a week, the longest window a rule can watch
    public async Task Acknowledge_RejectsADurationThatIsNotOne(int minutes)
    {
        var id = await ArrangeFiringRuleAsync();

        var response = await _client.PostAsJsonAsync($"/api/alerts/{id}/acknowledge", new { minutes });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Acknowledge_AnswersNotFoundForAnUnknownRule()
    {
        var response = await _client.PostAsJsonAsync("/api/alerts/9999/acknowledge", new { minutes = 60 });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
