using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace LogHarbor.Tests.Api;

/// <summary>
/// A webhook URL is a credential. A Slack or Discord incoming hook is a bearer token in URL
/// form, and many other targets carry their token in the query string — so the alerts list,
/// which every GET-allowed role can read, must not hand a read-only account the keys to every
/// integration this server posts to.
/// </summary>
public sealed class AlertWebhookMaskingTests : IDisposable
{
    private const string Secret = "tokenvalue-that-must-not-travel";
    private const string WebhookUrl = $"https://hooks.example.com/services/T1/B2/{Secret}";

    private readonly LogHarborApiFactory _factory = new();

    private HttpClient NewClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

    public void Dispose() => _factory.Dispose();

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        Assert.Equal(HttpStatusCode.OK,
            (await client.PostAsJsonAsync("/api/auth/login", new { username, password })).StatusCode);

    private static async Task<HttpClient> CreateRuleAndViewerAsync(LogHarborApiFactory factory, string webhookUrl)
    {
        var admin = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync(
            "/api/users", new { username = "alice", password = "password123", role = "admin" })).StatusCode);
        await LoginAsync(admin, "alice", "password123");
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync(
            "/api/users", new { username = "bob", password = "password123", role = "viewer" })).StatusCode);

        var created = await admin.PostAsJsonAsync("/api/alerts", new
        {
            title = "ship it",
            filter = "@Level = 'Fatal'",
            thresholdCount = 1,
            windowMinutes = 5,
            webhookUrl,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        return admin;
    }

    [Fact]
    public async Task AlertsList_HidesTheWebhookSecret_FromAReadOnlyAccount()
    {
        var admin = await CreateRuleAndViewerAsync(_factory, WebhookUrl);
        var viewer = NewClient();
        await LoginAsync(viewer, "bob", "password123");

        var response = await viewer.GetAsync("/api/alerts");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();

        // the whole point, asserted on the raw body rather than one field: the secret must not
        // appear anywhere in what a viewer is handed
        Assert.DoesNotContain(Secret, body);
        var rule = JsonDocument.Parse(body).RootElement.EnumerateArray().Single();
        // enough to recognise which integration a rule points at, never enough to post to it
        Assert.Equal("https://hooks.example.com/…", rule.GetProperty("webhookUrl").GetString());
        // and the rule itself is still visible: masking, not hiding
        Assert.Equal("ship it", rule.GetProperty("title").GetString());

        var forAdmin = await admin.GetAsync("/api/alerts");
        Assert.Contains(Secret, await forAdmin.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task MaskedWebhook_KeepsTheHostAndPort_SoTheTargetIsStillRecognisable()
    {
        await CreateRuleAndViewerAsync(_factory, "http://mattermost.internal:8065/hooks/abc123");
        var viewer = NewClient();
        await LoginAsync(viewer, "bob", "password123");

        var rules = await viewer.GetFromJsonAsync<JsonElement>("/api/alerts");
        Assert.Equal(
            "http://mattermost.internal:8065/…",
            rules.EnumerateArray().Single().GetProperty("webhookUrl").GetString());
    }
}
