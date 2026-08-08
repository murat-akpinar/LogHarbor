using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace LogHarbor.Tests.Api;

/// <summary>
/// A rule watches exactly one thing: a saved signal, or a filter it carries itself. These cover
/// the second half — the one that lets an install with no signals at all create an alert.
/// </summary>
public sealed class AlertOwnFilterTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public AlertOwnFilterTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private async Task<long> CreateSignalAsync()
    {
        var signal = await _client.PostAsJsonAsync(
            "/api/signals", new { title = $"sig-{Guid.NewGuid():N}", filter = "@Level = 'Error'" });
        Assert.Equal(HttpStatusCode.Created, signal.StatusCode);
        return (await signal.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();
    }

    /// <summary>Posts a rule with everything but the thing it watches; <paramref name="watched"/>
    /// supplies signalId, filter, both or neither.</summary>
    private Task<HttpResponseMessage> PostRuleAsync(object watched)
    {
        var body = new Dictionary<string, object?>
        {
            ["title"] = $"rule-{Guid.NewGuid():N}",
            ["thresholdCount"] = 1,
            ["windowMinutes"] = 5,
            ["webhookUrl"] = "https://example.com/hook",
            ["isEnabled"] = true,
        };
        foreach (var pair in JsonSerializer.SerializeToElement(watched).EnumerateObject())
        {
            body[pair.Name] = pair.Value;
        }
        return _client.PostAsJsonAsync("/api/alerts", body);
    }

    [Fact]
    public async Task AFilterWithoutASignal_IsCreated_AndCarriesNoSignalId()
    {
        var response = await PostRuleAsync(new { filter = "@Level = 'Error'" });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("@Level = 'Error'", created.GetProperty("filter").GetString());
        Assert.Equal(JsonValueKind.Null, created.GetProperty("signalId").ValueKind);

        var listed = await _client.GetFromJsonAsync<JsonElement>("/api/alerts");
        Assert.Equal("@Level = 'Error'", listed.EnumerateArray().Single().GetProperty("filter").GetString());
    }

    [Fact]
    public async Task NoSignalsExist_AndARuleCanStillBeCreated()
    {
        Assert.Empty((await _client.GetFromJsonAsync<JsonElement>("/api/signals")).EnumerateArray());

        var response = await PostRuleAsync(new { filter = "@Level = 'Fatal'" });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task BothASignalAndAFilter_IsRejected()
    {
        var response = await PostRuleAsync(new { signalId = await CreateSignalAsync(), filter = "@Level = 'Error'" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("filter", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task NeitherASignalNorAFilter_IsRejected()
    {
        var response = await PostRuleAsync(new { });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("filter", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ABlankFilter_CountsAsNoFilterAtAll()
    {
        var response = await PostRuleAsync(new { filter = "   " });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("filter", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ABlankFilter_DoesNotBlockASignal()
    {
        var response = await PostRuleAsync(new { signalId = await CreateSignalAsync(), filter = "  " });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, created.GetProperty("filter").ValueKind);
    }

    // caught at save time, not at the next evaluation: a typo in the box in front of you is a red
    // field, the same typo an hour later is a rule that silently never fires
    [Fact]
    public async Task AnUnparseableFilter_IsRejectedOnSave()
    {
        var response = await PostRuleAsync(new { filter = "@Level = = 'Error'" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("filter", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task AFilterIsTrimmedBeforeItIsStored()
    {
        var response = await PostRuleAsync(new { filter = "  @Level = 'Error'  " });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("@Level = 'Error'",
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("filter").GetString());
    }

    [Fact]
    public async Task ARuleCanBeMovedFromASignalToItsOwnFilter()
    {
        var created = await (await PostRuleAsync(new { signalId = await CreateSignalAsync() }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt64();

        var updated = await _client.PutAsJsonAsync($"/api/alerts/{id}", new
        {
            title = created.GetProperty("title").GetString(),
            filter = "@Level = 'Fatal'",
            thresholdCount = 1,
            windowMinutes = 5,
            webhookUrl = "https://example.com/hook",
            isEnabled = true,
        });

        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var body = await updated.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("@Level = 'Fatal'", body.GetProperty("filter").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("signalId").ValueKind);
    }

    [Fact]
    public async Task ARuleCanBeMovedFromItsOwnFilterToASignal()
    {
        var created = await (await PostRuleAsync(new { filter = "@Level = 'Fatal'" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt64();

        var updated = await _client.PutAsJsonAsync($"/api/alerts/{id}", new
        {
            title = created.GetProperty("title").GetString(),
            signalId = await CreateSignalAsync(),
            thresholdCount = 1,
            windowMinutes = 5,
            webhookUrl = "https://example.com/hook",
            isEnabled = true,
        });

        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var body = await updated.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, body.GetProperty("filter").ValueKind);
        Assert.NotEqual(JsonValueKind.Null, body.GetProperty("signalId").ValueKind);
    }
}
