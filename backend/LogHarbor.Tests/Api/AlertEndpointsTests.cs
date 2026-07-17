using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace LogHarbor.Tests.Api;

public sealed class AlertEndpointsTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public AlertEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private async Task<long> CreateSignalAsync()
    {
        var signal = await _client.PostAsJsonAsync(
            "/api/signals", new { title = $"sig-{Guid.NewGuid():N}", filter = "@Level = 'Error'" });
        Assert.Equal(HttpStatusCode.Created, signal.StatusCode);
        return (await signal.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();
    }

    private async Task<HttpResponseMessage> CreateAlertAsync(long signalId, object extra)
    {
        var body = new Dictionary<string, object?>
        {
            ["title"] = $"rule-{Guid.NewGuid():N}",
            ["signalId"] = signalId,
            ["thresholdCount"] = 1,
            ["windowMinutes"] = 5,
            ["webhookUrl"] = "https://example.com/hook",
            ["isEnabled"] = true,
        };
        foreach (var pair in JsonSerializer.SerializeToElement(extra).EnumerateObject())
        {
            body[pair.Name] = pair.Value;
        }
        return await _client.PostAsJsonAsync("/api/alerts", body);
    }

    [Fact]
    public async Task OmittedPayloadFormat_DefaultsToGeneric()
    {
        var response = await CreateAlertAsync(await CreateSignalAsync(), new { });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("generic", created.GetProperty("payloadFormat").GetString());
    }

    [Fact]
    public async Task ExplicitPayloadFormat_IsPersisted_AndListed()
    {
        var response = await CreateAlertAsync(await CreateSignalAsync(), new { payloadFormat = "discord" });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("discord",
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("payloadFormat").GetString());

        var listed = await _client.GetFromJsonAsync<JsonElement>("/api/alerts");
        Assert.Equal("discord", listed.EnumerateArray().Single().GetProperty("payloadFormat").GetString());
    }

    [Fact]
    public async Task UnknownPayloadFormat_IsRejected()
    {
        var response = await CreateAlertAsync(await CreateSignalAsync(), new { payloadFormat = "smoke-signals" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("payloadFormat", await response.Content.ReadAsStringAsync());
    }
}
