using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace LogHarbor.Tests.Api;

/// <summary>
/// /healthz is outside the auth gate and has to stay there — the container's HEALTHCHECK calls
/// it with no session. What it says to a caller with no session is a separate question: the
/// liveness verdict is the point, and event count, database size and free disk are capacity
/// facts about somebody's server that were going to anyone who could reach the port.
/// </summary>
public sealed class HealthDisclosureTests : IDisposable
{
    private static readonly string[] Numbers = ["eventCount", "dbSizeBytes", "freeDiskBytes"];

    private readonly LogHarborApiFactory _factory = new();

    private HttpClient NewClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

    public void Dispose() => _factory.Dispose();

    private async Task<HttpClient> SignedInAsync()
    {
        var client = NewClient();
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(
            "/api/users", new { username = "alice", password = "password123", role = "admin" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(
            "/api/auth/login", new { username = "alice", password = "password123" })).StatusCode);
        return client;
    }

    [Fact]
    public async Task WithNoSession_ItAnswersTheVerdictAndNothingElse()
    {
        await SignedInAsync();

        var anonymous = NewClient();
        var response = await anonymous.GetAsync("/healthz");

        // still 200: the status code is what curl -f in the HEALTHCHECK acts on, and trimming
        // the body must not change whether the container is considered up
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
        foreach (var number in Numbers)
        {
            Assert.False(body.TryGetProperty(number, out _), $"{number} reached an anonymous caller");
        }
    }

    [Fact]
    public async Task WithASession_TheNumbersAreStillThere()
    {
        var client = await SignedInAsync();

        var body = await client.GetFromJsonAsync<JsonElement>("/healthz");

        // the Settings page reads these, and the Events page reads eventCount to tell a first
        // run from a filter that matched nothing
        foreach (var number in Numbers)
        {
            Assert.True(body.TryGetProperty(number, out _), $"{number} went missing for a signed-in caller");
        }
    }

    [Fact]
    public async Task WithNoAuthConfiguredAtAll_NothingIsHidden()
    {
        // an install with no accounts has no session to hold, and the UI still needs the numbers
        var body = await NewClient().GetFromJsonAsync<JsonElement>("/healthz");

        Assert.Equal("ok", body.GetProperty("status").GetString());
        Assert.True(body.TryGetProperty("eventCount", out _));
    }
}
