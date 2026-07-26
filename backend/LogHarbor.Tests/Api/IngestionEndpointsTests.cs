using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace LogHarbor.Tests.Api;

public sealed class IngestionEndpointsTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public IngestionEndpointsTests() => _client = _factory.CreateClient();

    private async Task<string> CreateApiKeyAsync()
    {
        var response = await _client.PostAsJsonAsync("/api/apikeys", new { title = "test" });
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        return created.GetProperty("token").GetString()!;
    }

    private Task<HttpResponseMessage> PostRawAsync(string body, string? apiKey, string header = "X-LogHarbor-ApiKey")
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/vnd.serilog.clef"),
        };
        if (apiKey is not null)
        {
            request.Headers.Add(header, apiKey);
        }
        return _client.SendAsync(request);
    }

    /// <summary>seqlog and winston-seq post Seq's other wire format: one JSON document
    /// {"Events":[…]} as application/json, not newline-delimited CLEF.</summary>
    private Task<HttpResponseMessage> PostSeqRawEventsAsync(string body, string apiKey)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("X-Seq-ApiKey", apiKey);
        return _client.SendAsync(request);
    }

    private async Task<long> GetEventCountAsync()
    {
        var health = await _client.GetFromJsonAsync<JsonElement>("/healthz");
        return health.GetProperty("eventCount").GetInt64();
    }

    [Fact]
    public async Task MissingApiKey_Returns401()
    {
        var response = await PostRawAsync("""{"@t":"2026-07-13T10:00:00Z"}""", apiKey: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task InvalidApiKey_Returns401()
    {
        var response = await PostRawAsync("""{"@t":"2026-07-13T10:00:00Z"}""", "logharbor_not_a_real_key");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task RevokedApiKey_Returns401()
    {
        var token = await CreateApiKeyAsync();
        var listed = await _client.GetFromJsonAsync<JsonElement>("/api/apikeys");
        var id = listed.EnumerateArray().Single().GetProperty("id").GetInt64();
        await _client.DeleteAsync($"/api/apikeys/{id}");

        var response = await PostRawAsync("""{"@t":"2026-07-13T10:00:00Z"}""", token);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ValidBatch_Returns201_AndStoresEvents()
    {
        var token = await CreateApiKeyAsync();
        var body =
            """{"@t":"2026-07-13T10:00:00Z","@l":"Error","@mt":"Order {OrderId} failed","OrderId":1}""" + "\n" +
            "\n" + // blank lines are skipped
            """{"@t":"2026-07-13T10:00:01Z","@m":"plain message"}""";

        var response = await PostRawAsync(body, token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(2, await GetEventCountAsync());
    }

    [Fact]
    public async Task SeqApiKeyHeader_IsAccepted()
    {
        var token = await CreateApiKeyAsync();

        var response = await PostRawAsync(
            """{"@t":"2026-07-13T10:00:00Z","@m":"from a Seq sink"}""", token, header: "X-Seq-ApiKey");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(1, await GetEventCountAsync());
    }

    [Fact]
    public async Task InvalidSeqApiKeyHeader_Returns401()
    {
        var response = await PostRawAsync(
            """{"@t":"2026-07-13T10:00:00Z"}""", "logharbor_not_a_real_key", header: "X-Seq-ApiKey");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task SeqRawEventsEnvelope_Returns201_AndStoresStructuredProperties()
    {
        var token = await CreateApiKeyAsync();
        var body =
            """
            {"Events":[{"Timestamp":"2026-07-13T10:00:00Z","Level":"error",
            "MessageTemplate":"Order {OrderId} failed for {Customer}",
            "Properties":{"OrderId":123,"Customer":"acme"}}]}
            """;

        var response = await PostSeqRawEventsAsync(body, token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var page = await _client.GetFromJsonAsync<JsonElement>("/api/events");
        var stored = page.GetProperty("events").EnumerateArray().Single();
        Assert.Equal("Error", stored.GetProperty("level").GetString());
        Assert.Equal("Order 123 failed for acme", stored.GetProperty("message").GetString());
        Assert.Equal("Order {OrderId} failed for {Customer}",
            stored.GetProperty("messageTemplate").GetString());
        Assert.Equal("""{"OrderId":123,"Customer":"acme"}""",
            stored.GetProperty("properties").GetString());
    }

    [Fact]
    public async Task SeqRawEventsEnvelope_StoresEveryEventInTheBatch()
    {
        var token = await CreateApiKeyAsync();
        var body =
            """
            {"Events":[{"Timestamp":"2026-07-13T10:00:00Z","Message":"first"},
                       {"Timestamp":"2026-07-13T10:00:01Z","Message":"second"}]}
            """;

        var response = await PostSeqRawEventsAsync(body, token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(2, await GetEventCountAsync());
    }

    [Fact]
    public async Task SeqRawEventsEnvelope_BadEvent_Returns400WithEventNumber_AndStoresNothing()
    {
        var token = await CreateApiKeyAsync();
        var body =
            """{"Events":[{"Timestamp":"2026-07-13T10:00:00Z"},{"Level":"Error"}]}""";

        var response = await PostSeqRawEventsAsync(body, token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("event 2", problem.GetProperty("detail").GetString());
        Assert.Equal(0, await GetEventCountAsync());
    }

    [Fact]
    public async Task SeqRawEventsEnvelope_EventOverMaxEventBytes_Returns413WithEventNumber()
    {
        var token = await CreateApiKeyAsync();
        var filler = new string('x', LogHarborApiFactory.MaxEventBytes);
        var body =
            $$$"""
            {"Events":[{"Timestamp":"2026-07-13T10:00:00Z","Message":"ok"},
                       {"Timestamp":"2026-07-13T10:00:01Z","Properties":{"Filler":"{{{filler}}}"}}]}
            """;

        var response = await PostSeqRawEventsAsync(body, token);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("event 2", problem.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task SeqRawEventsEnvelope_MissingApiKey_Returns401()
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw")
        {
            Content = new StringContent(
                """{"Events":[{"Timestamp":"2026-07-13T10:00:00Z"}]}""",
                Encoding.UTF8, "application/json"),
        };

        var response = await _client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task BadLine_Returns400WithLineNumber_AndStoresNothing()
    {
        var token = await CreateApiKeyAsync();
        var body =
            """{"@t":"2026-07-13T10:00:00Z","@m":"ok"}""" + "\n" +
            "{not valid json}";

        var response = await PostRawAsync(body, token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("line 2", problem.GetProperty("detail").GetString());
        Assert.Equal(0, await GetEventCountAsync());
    }

    [Fact]
    public async Task BatchOverMaxBatchBytes_Returns413()
    {
        var token = await CreateApiKeyAsync();
        var filler = new string('x', LogHarborApiFactory.MaxEventBytes - 100);
        var lines = Enumerable.Range(0, LogHarborApiFactory.MaxBatchBytes / filler.Length + 2)
            .Select(_ => $$"""{"@t":"2026-07-13T10:00:00Z","Filler":"{{filler}}"}""");

        var response = await PostRawAsync(string.Join('\n', lines), token);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    public async Task EventOverMaxEventBytes_Returns413WithLineNumber()
    {
        var token = await CreateApiKeyAsync();
        var body =
            """{"@t":"2026-07-13T10:00:00Z","@m":"ok"}""" + "\n" +
            $$"""{"@t":"2026-07-13T10:00:00Z","Filler":"{{new string('x', LogHarborApiFactory.MaxEventBytes)}}"}""";

        var response = await PostRawAsync(body, token);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("line 2", problem.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task RequestsOverRateLimit_Return429()
    {
        var token = await CreateApiKeyAsync();
        var line = """{"@t":"2026-07-13T10:00:00Z","@m":"hi"}""";

        for (var i = 0; i < LogHarborApiFactory.RateLimitPerMinute; i++)
        {
            Assert.Equal(HttpStatusCode.Created, (await PostRawAsync(line, token)).StatusCode);
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostRawAsync(line, token)).StatusCode);
    }

    [Fact]
    public async Task IngestedTraceIds_AreQueryableViaTraceIdFilter()
    {
        var token = await CreateApiKeyAsync();
        var body =
            """{"@t":"2026-07-13T10:00:00Z","@m":"traced","@tr":"0af7651916cd43dd8448eb211c80319c","@sp":"b7ad6b7169203331"}""" + "\n" +
            """{"@t":"2026-07-13T10:00:01Z","@m":"untraced"}""";
        var response = await PostRawAsync(body, token);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var page = await _client.GetFromJsonAsync<JsonElement>(
            "/api/events?filter=" + Uri.EscapeDataString("@TraceId = '0af7651916cd43dd8448eb211c80319c'"));

        var matched = page.GetProperty("events").EnumerateArray().Single();
        Assert.Equal("traced", matched.GetProperty("message").GetString());
        Assert.Equal("0af7651916cd43dd8448eb211c80319c", matched.GetProperty("traceId").GetString());
        Assert.Equal("b7ad6b7169203331", matched.GetProperty("spanId").GetString());
    }

    [Fact]
    public async Task CsvExport_IncludesTraceColumns()
    {
        var token = await CreateApiKeyAsync();
        await PostRawAsync(
            """{"@t":"2026-07-13T10:00:00Z","@m":"traced","@tr":"0af7651916cd43dd8448eb211c80319c"}""", token);

        var csv = await _client.GetStringAsync("/api/events/export?format=csv");

        Assert.StartsWith("id,timestamp,level,message,messageTemplate,properties,exception,ingestedAt,traceId,spanId", csv);
        Assert.Contains("\"0af7651916cd43dd8448eb211c80319c\"", csv);
    }

    private async Task<JsonElement> GetRejectionsAsync()
    {
        var stats = await _client.GetFromJsonAsync<JsonElement>("/api/stats/ingest-rejections");
        return stats.GetProperty("rejections");
    }

    [Fact]
    public async Task BadPayload_IsRecordedAsARejection_WithTheKeyThatSentIt()
    {
        var token = await CreateApiKeyAsync();

        await PostRawAsync("{not valid json}", token);

        var rejection = (await GetRejectionsAsync()).EnumerateArray().Single();
        Assert.Equal("invalid_payload", rejection.GetProperty("reason").GetString());
        Assert.Equal("test", rejection.GetProperty("apiKeyTitle").GetString());
        Assert.Equal(1, rejection.GetProperty("requestCount").GetInt64());
        Assert.Contains("line 1", rejection.GetProperty("lastDetail").GetString());
    }

    [Fact]
    public async Task RepeatedBadPayloads_CollapseIntoOneBucket()
    {
        var token = await CreateApiKeyAsync();

        await PostRawAsync("{not valid json}", token);
        await PostRawAsync("""{"@t":"nonsense"}""", token);

        var rejection = (await GetRejectionsAsync()).EnumerateArray().Single();
        Assert.Equal(2, rejection.GetProperty("requestCount").GetInt64());
        Assert.Contains("@t", rejection.GetProperty("lastDetail").GetString());
    }

    [Fact]
    public async Task InvalidApiKey_IsRecorded_WithoutAKeyTitle()
    {
        await PostRawAsync("""{"@t":"2026-07-13T10:00:00Z"}""", "logharbor_not_a_real_key");

        var rejection = (await GetRejectionsAsync()).EnumerateArray().Single();
        Assert.Equal("unauthorized", rejection.GetProperty("reason").GetString());
        Assert.Equal(0, rejection.GetProperty("apiKeyId").GetInt64());
        Assert.Equal(JsonValueKind.Null, rejection.GetProperty("apiKeyTitle").ValueKind);
    }

    [Fact]
    public async Task OversizedBatch_IsRecordedAsTooLarge()
    {
        var token = await CreateApiKeyAsync();
        var filler = new string('x', LogHarborApiFactory.MaxEventBytes - 100);
        var lines = Enumerable.Range(0, LogHarborApiFactory.MaxBatchBytes / filler.Length + 2)
            .Select(_ => $$"""{"@t":"2026-07-13T10:00:00Z","Filler":"{{filler}}"}""");

        await PostRawAsync(string.Join('\n', lines), token);

        var rejection = (await GetRejectionsAsync()).EnumerateArray().Single();
        Assert.Equal("too_large", rejection.GetProperty("reason").GetString());
    }

    [Fact]
    public async Task RateLimitedRequests_AreRecorded()
    {
        var token = await CreateApiKeyAsync();
        var line = """{"@t":"2026-07-13T10:00:00Z","@m":"hi"}""";
        for (var i = 0; i < LogHarborApiFactory.RateLimitPerMinute; i++)
        {
            await PostRawAsync(line, token);
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostRawAsync(line, token)).StatusCode);

        var rejection = (await GetRejectionsAsync()).EnumerateArray().Single();
        Assert.Equal("rate_limited", rejection.GetProperty("reason").GetString());
        Assert.Equal("test", rejection.GetProperty("apiKeyTitle").GetString());
    }

    [Fact]
    public async Task SuccessfulIngestion_RecordsNoRejection()
    {
        var token = await CreateApiKeyAsync();

        await PostRawAsync("""{"@t":"2026-07-13T10:00:00Z","@m":"fine"}""", token);

        Assert.Empty((await GetRejectionsAsync()).EnumerateArray());
    }

    public void Dispose() => _factory.Dispose();
}
