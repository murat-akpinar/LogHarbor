using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace LogHarbor.Tests.Api;

/// <summary>The deny-list end to end: saved in Settings, applied on the way in, and readable
/// afterwards only as the placeholder (docs/redaction.md).</summary>
public sealed class RedactionEndpointsTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public RedactionEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private async Task<string> CreateApiKeyAsync()
    {
        var response = await _client.PostAsJsonAsync("/api/apikeys", new { title = "test" });
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        return created.GetProperty("token").GetString()!;
    }

    private async Task IngestAsync(string clefLine)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw")
        {
            Content = new StringContent(clefLine, Encoding.UTF8, "application/vnd.serilog.clef"),
        };
        request.Headers.Add("X-LogHarbor-ApiKey", await CreateApiKeyAsync());
        var response = await _client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private async Task<JsonElement> NewestEventAsync()
    {
        var page = await _client.GetFromJsonAsync<JsonElement>("/api/events?count=1");
        return page.GetProperty("events").EnumerateArray().Single();
    }

    [Fact]
    public async Task Unconfigured_ReadsBackEmpty()
    {
        var settings = await _client.GetFromJsonAsync<JsonElement>("/api/settings/redaction");

        Assert.Empty(settings.GetProperty("properties").EnumerateArray());
        Assert.False(settings.GetProperty("enabled").GetBoolean());
    }

    /// <summary>The shipped state has to be "keep everything": a server that quietly dropped
    /// fields nobody named would lose data invisibly and permanently.</summary>
    [Fact]
    public async Task NothingConfigured_StoresTheEventVerbatim()
    {
        await IngestAsync("""{"@t":"2026-08-07T10:00:00Z","@mt":"Signed in","Password":"hunter2"}""");

        var stored = await NewestEventAsync();
        Assert.Contains("hunter2", stored.GetProperty("properties").GetString());
    }

    [Fact]
    public async Task Configured_RedactsOnTheWayIn()
    {
        var put = await _client.PutAsJsonAsync("/api/settings/redaction",
            new { properties = new[] { "password", "authorization" } });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        await IngestAsync("""
            {"@t":"2026-08-07T10:00:00Z","@mt":"Signed in as {User}","User":"ada","Password":"hunter2",
             "Request":{"Headers":{"Authorization":"Bearer abc"}}}
            """.ReplaceLineEndings(""));

        var properties = (await NewestEventAsync()).GetProperty("properties").GetString()!;
        Assert.DoesNotContain("hunter2", properties);
        Assert.DoesNotContain("Bearer abc", properties);
        // the key survives: "carried no Authorization" and "we refused to keep it" differ
        Assert.Contains("Authorization", properties);
        Assert.Contains("[redacted]", properties);
        // and the property that was not named is untouched
        Assert.Contains("ada", properties);
    }

    /// <summary>The rendered message is the properties spelled into a sentence, so redacting
    /// the bag alone would leave the secret on the row.</summary>
    [Fact]
    public async Task Configured_TakesTheSecretOutOfTheRenderedMessageToo()
    {
        await _client.PutAsJsonAsync("/api/settings/redaction", new { properties = new[] { "password" } });

        await IngestAsync(
            """{"@t":"2026-08-07T10:00:00Z","@mt":"Signed in as {User} with {Password}","User":"ada","Password":"hunter2"}""");

        var stored = await NewestEventAsync();
        Assert.Equal("Signed in as ada with [redacted]", stored.GetProperty("message").GetString());
    }

    /// <summary>OTLP is the other way in, and a format that skipped this step would keep exactly
    /// what an operator told this server not to keep.</summary>
    [Fact]
    public async Task Configured_RedactsTheOtlpPathToo()
    {
        await _client.PutAsJsonAsync("/api/settings/redaction", new { properties = new[] { "token" } });

        var body = """
            {"resourceLogs":[{"scopeLogs":[{"logRecords":[{
              "timeUnixNano":"1785060000000000000",
              "severityNumber":9,
              "body":{"stringValue":"call made"},
              "attributes":[{"key":"AccessToken","value":{"stringValue":"abc123xyz"}},
                            {"key":"UserId","value":{"stringValue":"ada"}}]}]}]}]}
            """;
        var request = new HttpRequestMessage(HttpMethod.Post, "/v1/logs")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("X-LogHarbor-ApiKey", await CreateApiKeyAsync());
        Assert.Equal(HttpStatusCode.OK, (await _client.SendAsync(request)).StatusCode);

        var properties = (await NewestEventAsync()).GetProperty("properties").GetString()!;
        Assert.DoesNotContain("abc123xyz", properties);
        Assert.Contains("[redacted]", properties);
        Assert.Contains("ada", properties);
    }

    /// <summary>Two entries differing only in case are one rule: the match is case-insensitive,
    /// so a list that shows both is lying about what it does.</summary>
    [Fact]
    public async Task Saving_TrimsLowercasesAndDeduplicates()
    {
        var put = await _client.PutAsJsonAsync("/api/settings/redaction",
            new { properties = new[] { "  Password ", "PASSWORD", "token", "" } });

        var saved = await put.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(["password", "token"],
            saved.GetProperty("properties").EnumerateArray().Select(value => value.GetString()).ToArray());
    }

    [Theory]
    [InlineData(60)]
    public async Task Saving_RejectsAListTooLongToRead(int count)
    {
        var names = Enumerable.Range(0, count).Select(index => $"name{index}").ToArray();

        var put = await _client.PutAsJsonAsync("/api/settings/redaction", new { properties = names });

        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
    }

    /// <summary>No sink writes a property name with a control character in it, so one in the
    /// list is a paste accident that would sit there matching nothing.</summary>
    [Fact]
    public async Task Saving_RejectsANameNoSinkCouldWrite()
    {
        var put = await _client.PutAsJsonAsync("/api/settings/redaction",
            new { properties = new[] { "pass" + (char)1 + "word" } });

        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
    }

    [Fact]
    public async Task Saving_RejectsANameLongerThanAnyProperty()
    {
        var put = await _client.PutAsJsonAsync("/api/settings/redaction",
            new { properties = new[] { new string('x', 65) } });

        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
    }
}
