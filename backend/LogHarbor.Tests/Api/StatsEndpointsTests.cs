using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Api;

public sealed class StatsEndpointsTests : IAsyncLifetime
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public StatsEndpointsTests() => _client = _factory.CreateClient();

    public async Task InitializeAsync()
    {
        var store = _factory.Services.GetRequiredService<IEventStore>();
        await store.WriteBatchAsync(
        [
            Seed("2026-07-13T10:05:00.0000000Z", "Information"),
            Seed("2026-07-13T10:20:00.0000000Z", "Error"),
            Seed("2026-07-13T10:50:00.0000000Z", "Error"),
            Seed("2026-07-13T12:00:00.0000000Z", "Warning"), // outside the [10:00,11:00] range used below
            // analysis seeds live on 2026-07-14 so they never leak into the histogram/summary tests above
            SeedAnalysis("2026-07-14T10:05:00.0000000Z", "Error", "Order {OrderId} failed",
                "System.InvalidOperationException: boom\n   at Api.Handle()", """{"OrderId":1}"""),
            SeedAnalysis("2026-07-14T10:15:00.0000000Z", "Error", "Order {OrderId} failed",
                "System.InvalidOperationException: bam\n   at Api.Handle()", """{"OrderId":2}"""),
            SeedAnalysis("2026-07-14T10:25:00.0000000Z", "Fatal", "Db down", "CustomFailure", null),
            SeedAnalysis("2026-07-14T10:35:00.0000000Z", "Warning", "Slow request {Path}", null, """{"Path":"/a"}"""),
            SeedAnalysis("2026-07-14T10:45:00.0000000Z", "Error", null, null, """{"OrderId":1}"""),
        ]);
    }

    private const string AnalysisRange = "from=2026-07-14T10:00:00Z&to=2026-07-14T11:00:00Z";

    public Task DisposeAsync()
    {
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private static Event Seed(string timestamp, string level) =>
        new(0, timestamp, level, "msg", null, null, null, timestamp);

    private static Event SeedAnalysis(
        string timestamp, string level, string? template, string? exception, string? properties) =>
        new(0, timestamp, level, "msg", template, properties, exception, timestamp);

    private static Event Timed(string timestamp, string template, int elapsedMs) =>
        new(0, timestamp, "Information", "msg", template, $$"""{"Elapsed":{{elapsedMs}}}""", null, timestamp);

    [Fact]
    public async Task Services_GroupsByServiceIdentity_WithRedNumbers()
    {
        // 2026-07-16: a day the shared seeds never touch
        var store = _factory.Services.GetRequiredService<IEventStore>();
        await store.WriteBatchAsync(
        [
            new Event(0, "2026-07-16T10:00:00.0000000Z", "Information", "ok", null,
                """{"service.name":"checkout","Elapsed":20}""", null, "2026-07-16T10:00:00.0000000Z"),
            new Event(0, "2026-07-16T10:01:00.0000000Z", "Error", "boom", null,
                """{"Service":"checkout","Elapsed":80}""", null, "2026-07-16T10:01:00.0000000Z"),
        ]);

        var page = await _client.GetFromJsonAsync<JsonElement>(
            "/api/stats/services?from=2026-07-16T10:00:00Z&to=2026-07-16T11:00:00Z");

        var row = page.GetProperty("services").EnumerateArray().Single();
        Assert.Equal("checkout", row.GetProperty("service").GetString());
        Assert.Equal(2, row.GetProperty("total").GetInt64());
        Assert.Equal(1, row.GetProperty("errorCount").GetInt64());
        Assert.Equal(80, row.GetProperty("p95ElapsedMs").GetDouble());
    }

    [Fact]
    public async Task Operations_GroupsByTemplate_WithRedNumbers()
    {
        // 2026-07-17: a day the shared seeds never touch
        var store = _factory.Services.GetRequiredService<IEventStore>();
        await store.WriteBatchAsync(
        [
            new Event(0, "2026-07-17T10:00:00.0000000Z", "Information", "ok", "GET /orders",
                """{"Elapsed":20}""", null, "2026-07-17T10:00:00.0000000Z"),
            new Event(0, "2026-07-17T10:01:00.0000000Z", "Error", "boom", "GET /orders",
                """{"Elapsed":80}""", null, "2026-07-17T10:01:00.0000000Z"),
        ]);

        var page = await _client.GetFromJsonAsync<JsonElement>(
            "/api/stats/operations?from=2026-07-17T10:00:00Z&to=2026-07-17T11:00:00Z");

        var row = page.GetProperty("operations").EnumerateArray().Single();
        Assert.Equal("GET /orders", row.GetProperty("template").GetString());
        Assert.Equal(2, row.GetProperty("total").GetInt64());
        Assert.Equal(1, row.GetProperty("errorCount").GetInt64());
        Assert.Equal(80, row.GetProperty("p95ElapsedMs").GetDouble());
    }

    [Fact]
    public async Task Operations_CarriesEachRowsTrend_WhenTrendBucketsAsked()
    {
        // 2026-07-13: a day the shared seeds never touch
        var store = _factory.Services.GetRequiredService<IEventStore>();
        await store.WriteBatchAsync(
        [
            // two in the first quarter of the window, one in the last: a shape, not a flat line
            new Event(0, "2026-07-13T10:00:00.0000000Z", "Information", "ok", "GET /a",
                """{"Path":"/a","Method":"GET"}""", null, "2026-07-13T10:00:00.0000000Z"),
            new Event(0, "2026-07-13T10:05:00.0000000Z", "Information", "ok", "GET /a",
                """{"Path":"/a","Method":"GET"}""", null, "2026-07-13T10:05:00.0000000Z"),
            new Event(0, "2026-07-13T10:50:00.0000000Z", "Information", "ok", "GET /a",
                """{"Path":"/a","Method":"GET"}""", null, "2026-07-13T10:50:00.0000000Z"),
            // a second operation, so the trends cannot be one series handed to every row
            new Event(0, "2026-07-13T10:30:00.0000000Z", "Information", "ok", "GET /b",
                """{"Path":"/b","Method":"GET"}""", null, "2026-07-13T10:30:00.0000000Z"),
        ]);

        var page = await _client.GetFromJsonAsync<JsonElement>(
            "/api/stats/operations?from=2026-07-13T10:00:00Z&to=2026-07-13T11:00:00Z&trendBuckets=4");

        var rows = page.GetProperty("operations").EnumerateArray()
            .ToDictionary(row => row.GetProperty("template").GetString()!);

        // four buckets of fifteen minutes: 10:00 and 10:05 land in the first, 10:50 in the last
        var a = rows["GET /a"].GetProperty("trend").EnumerateArray().Select(v => v.GetInt64()).ToArray();
        Assert.Equal([2, 0, 0, 1], a);
        // and the other row carries its own, in the bucket its one event belongs to
        var b = rows["GET /b"].GetProperty("trend").EnumerateArray().Select(v => v.GetInt64()).ToArray();
        Assert.Equal([0, 0, 1, 0], b);
        // the strip has to agree with the total beside it
        Assert.Equal(3, rows["GET /a"].GetProperty("total").GetInt64());
    }

    [Fact]
    public async Task Operations_OmitsTrend_WhenNotAsked()
    {
        // callers that draw no strip should not pay for the aggregation
        var page = await _client.GetFromJsonAsync<JsonElement>(
            "/api/stats/operations?from=2026-07-17T10:00:00Z&to=2026-07-17T11:00:00Z");

        foreach (var row in page.GetProperty("operations").EnumerateArray())
        {
            Assert.Equal(JsonValueKind.Null, row.GetProperty("trend").ValueKind);
        }
    }

    [Fact]
    public async Task Operations_RejectsAnAbsurdTrendWidth()
    {
        var response = await _client.GetAsync(
            "/api/stats/operations?from=2026-07-17T10:00:00Z&to=2026-07-17T11:00:00Z&trendBuckets=5000");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Queries_GroupsBySqlText_WithDurations()
    {
        // 2026-07-19: a day the shared seeds never touch
        var store = _factory.Services.GetRequiredService<IEventStore>();
        await store.WriteBatchAsync(
        [
            new Event(0, "2026-07-19T10:00:00.0000000Z", "Information", "q", null,
                """{"commandText":"SELECT * FROM orders WHERE id = @p0","elapsed":10,"connection":"main"}""",
                null, "2026-07-19T10:00:00.0000000Z"),
            new Event(0, "2026-07-19T10:01:00.0000000Z", "Error", "q", null,
                """{"commandText":"SELECT * FROM orders WHERE id = @p0","elapsed":100,"connection":"main"}""",
                null, "2026-07-19T10:01:00.0000000Z"),
            new Event(0, "2026-07-19T10:02:00.0000000Z", "Information", "q", null,
                """{"commandText":"SELECT * FROM orders WHERE id = @p0","elapsed":20,"connection":"main"}""",
                null, "2026-07-19T10:02:00.0000000Z"),
            // a query that never reports a duration or connection
            new Event(0, "2026-07-19T10:03:00.0000000Z", "Information", "q", null,
                """{"commandText":"PRAGMA user_version"}""", null, "2026-07-19T10:03:00.0000000Z"),
            // no commandText -> excluded entirely
            new Event(0, "2026-07-19T10:04:00.0000000Z", "Information", "q", null,
                """{"elapsed":999}""", null, "2026-07-19T10:04:00.0000000Z"),
        ]);

        var page = await _client.GetFromJsonAsync<JsonElement>(
            "/api/stats/queries?from=2026-07-19T10:00:00Z&to=2026-07-19T11:00:00Z");

        var rows = page.GetProperty("queries").EnumerateArray().ToList();
        Assert.Equal(2, rows.Count);

        // timed group first (ordered by total time)
        var timed = rows[0];
        Assert.Equal("SELECT * FROM orders WHERE id = @p0", timed.GetProperty("value").GetString());
        Assert.Equal("main", timed.GetProperty("connection").GetString());
        Assert.Equal(3, timed.GetProperty("calls").GetInt64());
        Assert.Equal(1, timed.GetProperty("errorCount").GetInt64());
        Assert.Equal(130, timed.GetProperty("totalMs").GetDouble());
        Assert.Equal(130.0 / 3, timed.GetProperty("avgMs").GetDouble(), precision: 5);
        Assert.Equal(100, timed.GetProperty("p95Ms").GetDouble());
        Assert.Equal("2026-07-19T10:02:00.0000000Z", timed.GetProperty("lastSeen").GetString());

        var untimed = rows[1];
        Assert.Equal("PRAGMA user_version", untimed.GetProperty("value").GetString());
        Assert.Equal(JsonValueKind.Null, untimed.GetProperty("connection").ValueKind);
        Assert.Equal(1, untimed.GetProperty("calls").GetInt64());
        Assert.Equal(JsonValueKind.Null, untimed.GetProperty("totalMs").ValueKind);
        Assert.Equal(JsonValueKind.Null, untimed.GetProperty("p95Ms").ValueKind);
    }

    [Fact]
    public async Task Queries_RejectsInvalidPropertyName()
    {
        var response = await _client.GetAsync(
            "/api/stats/queries?from=2026-07-19T10:00:00Z&to=2026-07-19T11:00:00Z&property=bad;name");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UserActivity_GroupsByUserProperty()
    {
        // 2026-07-18: a day the shared seeds never touch
        var store = _factory.Services.GetRequiredService<IEventStore>();
        await store.WriteBatchAsync(
        [
            new Event(0, "2026-07-18T10:00:00.0000000Z", "Information", "in", "User {UserId} signed in",
                """{"UserId":"alice"}""", null, "2026-07-18T10:00:00.0000000Z"),
            new Event(0, "2026-07-18T10:01:00.0000000Z", "Error", "boom", "Failed login for {UserId}",
                """{"UserId":"alice"}""", null, "2026-07-18T10:01:00.0000000Z"),
        ]);

        var page = await _client.GetFromJsonAsync<JsonElement>(
            "/api/stats/user-activity?from=2026-07-18T10:00:00Z&to=2026-07-18T11:00:00Z");

        var row = page.GetProperty("users").EnumerateArray().Single();
        Assert.Equal("alice", row.GetProperty("value").GetString());
        Assert.Equal(2, row.GetProperty("total").GetInt64());
        Assert.Equal(1, row.GetProperty("errorCount").GetInt64());
    }

    [Fact]
    public async Task Histogram_BucketsCountsByLevel()
    {
        var response = await _client.GetAsync(
            "/api/stats/histogram?from=2026-07-13T10:00:00Z&to=2026-07-13T11:00:00Z&buckets=4");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var buckets = body.GetProperty("buckets").EnumerateArray().ToList();
        Assert.Equal(4, buckets.Count);
        Assert.Equal(1, buckets[0].GetProperty("counts").GetProperty("Information").GetInt64());
        Assert.Equal(1, buckets[1].GetProperty("counts").GetProperty("Error").GetInt64());
        Assert.Equal(1, buckets[3].GetProperty("counts").GetProperty("Error").GetInt64());
    }

    [Fact]
    public async Task Latency_AnswersWithTheRangeFiguresAndTheSeries()
    {
        var response = await _client.GetAsync(
            "/api/stats/latency?from=2026-07-13T10:00:00Z&to=2026-07-13T11:00:00Z&buckets=4");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(4, body.GetProperty("buckets").GetArrayLength());
        // the seeded events carry no Elapsed, so the honest answer is "nothing was timed"
        Assert.Equal(0, body.GetProperty("sampled").GetInt64());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("avgMs").ValueKind);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("p95Ms").ValueKind);
    }

    [Theory]
    [InlineData("/api/stats/latency?from=not-a-date&to=2026-07-13T11:00:00Z")]
    [InlineData("/api/stats/latency?from=2026-07-13T10:00:00Z&to=2026-07-13T11:00:00Z&buckets=501")]
    public async Task Latency_RejectsABadRange(string url)
    {
        var response = await _client.GetAsync(url);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Histogram_WithFilter_OnlyCountsMatching()
    {
        var response = await _client.GetAsync(
            "/api/stats/histogram?from=2026-07-13T10:00:00Z&to=2026-07-13T11:00:00Z&buckets=1&filter=" +
            Uri.EscapeDataString("@Level = 'Error'"));

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var bucket = body.GetProperty("buckets").EnumerateArray().Single();
        Assert.Equal(2, bucket.GetProperty("counts").GetProperty("Error").GetInt64());
        Assert.Equal(0, bucket.GetProperty("counts").GetProperty("Information").GetInt64());
    }

    [Theory]
    [InlineData("/api/stats/histogram?from=not-a-date&to=2026-07-13T11:00:00Z")]
    [InlineData("/api/stats/histogram?from=2026-07-13T11:00:00Z&to=2026-07-13T10:00:00Z")]
    [InlineData("/api/stats/histogram?from=2026-07-13T10:00:00Z&to=2026-07-13T11:00:00Z&buckets=0")]
    [InlineData("/api/stats/histogram?from=2026-07-13T10:00:00Z&to=2026-07-13T11:00:00Z&buckets=501")]
    [InlineData("/api/stats/histogram?from=2026-07-13T10:00:00Z&to=2026-07-13T11:00:00Z&filter=%40Bogus%20%3D%201")]
    public async Task Histogram_InvalidInput_Returns400(string url)
    {
        var response = await _client.GetAsync(url);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Summary_ReturnsTotalAndByLevel()
    {
        var response = await _client.GetAsync(
            "/api/stats/summary?from=2026-07-13T10:00:00Z&to=2026-07-13T11:00:00Z");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(3, body.GetProperty("total").GetInt64());
        Assert.Equal(2, body.GetProperty("byLevel").GetProperty("Error").GetInt64());
        Assert.Equal(1, body.GetProperty("byLevel").GetProperty("Information").GetInt64());
        Assert.Equal(0, body.GetProperty("byLevel").GetProperty("Fatal").GetInt64());
    }

    [Fact]
    public async Task Summary_WithFilter_OnlyCountsMatching()
    {
        var response = await _client.GetAsync(
            "/api/stats/summary?from=2026-07-13T10:00:00Z&to=2026-07-13T11:00:00Z&filter=" +
            Uri.EscapeDataString("@Level = 'Error'"));

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, body.GetProperty("total").GetInt64());
    }

    [Theory]
    [InlineData("/api/stats/summary?from=not-a-date&to=2026-07-13T11:00:00Z")]
    [InlineData("/api/stats/summary?from=2026-07-13T11:00:00Z&to=2026-07-13T10:00:00Z")]
    public async Task Summary_InvalidInput_Returns400(string url)
    {
        var response = await _client.GetAsync(url);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Heatmap_CountsByDayOfWeekAndHour()
    {
        // 2026-07-13 is a Monday (dow 1), 2026-07-14 a Tuesday (dow 2)
        var response = await _client.GetAsync(
            "/api/stats/heatmap?from=2026-07-13T00:00:00Z&to=2026-07-15T00:00:00Z");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var cells = body.GetProperty("cells").EnumerateArray()
            .Select(cell => (
                Dow: cell.GetProperty("dayOfWeek").GetInt32(),
                Hour: cell.GetProperty("hour").GetInt32(),
                Count: cell.GetProperty("count").GetInt64()))
            .ToList();
        Assert.Equal([(1, 10, 3), (1, 12, 1), (2, 10, 5)], cells);
    }

    [Fact]
    public async Task Heatmap_WithFilter_OnlyCountsMatching()
    {
        var response = await _client.GetAsync(
            "/api/stats/heatmap?from=2026-07-13T00:00:00Z&to=2026-07-15T00:00:00Z&filter=" +
            Uri.EscapeDataString("@Level = 'Error'"));

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var cells = body.GetProperty("cells").EnumerateArray()
            .Select(cell => (
                Dow: cell.GetProperty("dayOfWeek").GetInt32(),
                Hour: cell.GetProperty("hour").GetInt32(),
                Count: cell.GetProperty("count").GetInt64()))
            .ToList();
        Assert.Equal([(1, 10, 2), (2, 10, 3)], cells);
    }

    [Theory]
    [InlineData("/api/stats/heatmap?from=not-a-date&to=2026-07-15T00:00:00Z")]
    [InlineData("/api/stats/heatmap?from=2026-07-15T00:00:00Z&to=2026-07-13T00:00:00Z")]
    [InlineData("/api/stats/heatmap?from=2026-07-13T00:00:00Z&to=2026-07-15T00:00:00Z&filter=%40Bogus%20%3D%201")]
    public async Task Heatmap_InvalidInput_Returns400(string url)
    {
        var response = await _client.GetAsync(url);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task TopErrors_GroupsByTemplateAndLevel_ErrorAndFatalByDefault()
    {
        var response = await _client.GetAsync($"/api/stats/top-errors?{AnalysisRange}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var errors = body.GetProperty("errors").EnumerateArray().ToList();
        // the Warning event and the template-less Error are excluded
        Assert.Equal(2, errors.Count);
        Assert.Equal("Order {OrderId} failed", errors[0].GetProperty("template").GetString());
        Assert.Equal("Error", errors[0].GetProperty("level").GetString());
        Assert.Equal(2, errors[0].GetProperty("count").GetInt64());
        Assert.Equal("2026-07-14T10:05:00.0000000Z", errors[0].GetProperty("firstSeen").GetString());
        Assert.Equal("2026-07-14T10:15:00.0000000Z", errors[0].GetProperty("lastSeen").GetString());
        Assert.Equal("Db down", errors[1].GetProperty("template").GetString());
        Assert.Equal("Fatal", errors[1].GetProperty("level").GetString());
        Assert.Equal(1, errors[1].GetProperty("count").GetInt64());
    }

    [Fact]
    public async Task TopErrors_LevelsOverride_CountsOnlyThoseLevels()
    {
        var response = await _client.GetAsync($"/api/stats/top-errors?{AnalysisRange}&levels=Warning");

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var errors = body.GetProperty("errors").EnumerateArray().ToList();
        Assert.Equal("Slow request {Path}", Assert.Single(errors).GetProperty("template").GetString());
    }

    [Fact]
    public async Task TopErrors_WithFilter_OnlyCountsMatching()
    {
        var response = await _client.GetAsync(
            $"/api/stats/top-errors?{AnalysisRange}&filter=" + Uri.EscapeDataString("OrderId = 2"));

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var errors = body.GetProperty("errors").EnumerateArray().ToList();
        Assert.Equal(1, Assert.Single(errors).GetProperty("count").GetInt64());
    }

    [Theory]
    [InlineData("/api/stats/top-errors?from=not-a-date&to=2026-07-14T11:00:00Z")]
    [InlineData("/api/stats/top-errors?from=2026-07-14T10:00:00Z&to=2026-07-14T11:00:00Z&limit=0")]
    [InlineData("/api/stats/top-errors?from=2026-07-14T10:00:00Z&to=2026-07-14T11:00:00Z&limit=101")]
    [InlineData("/api/stats/top-errors?from=2026-07-14T10:00:00Z&to=2026-07-14T11:00:00Z&levels=Bogus")]
    [InlineData("/api/stats/top-errors?from=2026-07-14T10:00:00Z&to=2026-07-14T11:00:00Z&filter=%40Bogus%20%3D%201")]
    public async Task TopErrors_InvalidInput_Returns400(string url)
    {
        var response = await _client.GetAsync(url);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task TopExceptions_GroupsByFirstLineUpToColon()
    {
        var response = await _client.GetAsync($"/api/stats/top-exceptions?{AnalysisRange}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var exceptions = body.GetProperty("exceptions").EnumerateArray().ToList();
        Assert.Equal(2, exceptions.Count);
        Assert.Equal("System.InvalidOperationException", exceptions[0].GetProperty("type").GetString());
        Assert.Equal(2, exceptions[0].GetProperty("count").GetInt64());
        Assert.Equal("2026-07-14T10:05:00.0000000Z", exceptions[0].GetProperty("firstSeen").GetString());
        Assert.Equal("2026-07-14T10:15:00.0000000Z", exceptions[0].GetProperty("lastSeen").GetString());
        // no file reference in the seeded traces -> null location
        Assert.Equal(JsonValueKind.Null, exceptions[0].GetProperty("location").ValueKind);
        // no colon anywhere: the whole first line is the type
        Assert.Equal("CustomFailure", exceptions[1].GetProperty("type").GetString());
        Assert.Equal(1, exceptions[1].GetProperty("count").GetInt64());
    }

    [Fact]
    public async Task TopExceptions_LocationComesFromLatestOccurrence()
    {
        // 2026-07-20: a day the shared seeds never touch
        var store = _factory.Services.GetRequiredService<IEventStore>();
        await store.WriteBatchAsync(
        [
            SeedAnalysis("2026-07-20T10:00:00.0000000Z", "Error", "x",
                "System.NullReferenceException: a\n   at A.F() in /src/Old.cs:line 1", null),
            SeedAnalysis("2026-07-20T10:05:00.0000000Z", "Error", "x",
                "System.NullReferenceException: b\n   at B.G() in /src/New.cs:line 9", null),
        ]);

        var body = await _client.GetFromJsonAsync<JsonElement>(
            "/api/stats/top-exceptions?from=2026-07-20T10:00:00Z&to=2026-07-20T11:00:00Z");

        var row = body.GetProperty("exceptions").EnumerateArray().Single();
        Assert.Equal("/src/New.cs:9", row.GetProperty("location").GetString());
    }

    private static Event Probe(string timestamp, string service, string properties) =>
        new(0, timestamp, "Information", $"Service {service} is up", "Service {service} is {state}",
            properties, null, timestamp);

    [Fact]
    public async Task ServiceStatus_DerivesStatusFromTheNewestReading()
    {
        // 2026-07-21: a day the shared seeds never touch
        var store = _factory.Services.GetRequiredService<IEventStore>();
        await store.WriteBatchAsync(
        [
            Probe("2026-07-21T10:58:00.0000000Z", "nginx",
                """{"Source":"service-probe","host":"web-1","kind":"systemd","service":"nginx","up":1,"state":"active"}"""),
            Probe("2026-07-21T10:59:00.0000000Z", "api",
                """{"Source":"service-probe","host":"web-1","kind":"docker","service":"api","up":0,"state":"exited"}"""),
            // last heartbeat an hour before the range end: the probe or the host went away
            Probe("2026-07-21T10:00:00.0000000Z", "cron",
                """{"Source":"service-probe","host":"web-1","kind":"systemd","service":"cron","up":1,"state":"active"}"""),
        ]);

        var body = await _client.GetFromJsonAsync<JsonElement>(
            "/api/stats/service-status?from=2026-07-21T10:00:00Z&to=2026-07-21T11:00:00Z");

        Assert.Equal(5, body.GetProperty("staleMinutes").GetInt32());
        var rows = body.GetProperty("services").EnumerateArray().ToList();
        Assert.Equal(3, rows.Count);
        // broken first
        Assert.Equal("api", rows[0].GetProperty("service").GetString());
        Assert.Equal("down", rows[0].GetProperty("status").GetString());
        Assert.Equal("exited", rows[0].GetProperty("state").GetString());
        Assert.Equal("docker", rows[0].GetProperty("kind").GetString());
        Assert.Equal("cron", rows[1].GetProperty("service").GetString());
        Assert.Equal("stale", rows[1].GetProperty("status").GetString());
        Assert.Equal(3600, rows[1].GetProperty("secondsSinceLastSeen").GetInt64());
        Assert.Equal("nginx", rows[2].GetProperty("service").GetString());
        Assert.Equal("up", rows[2].GetProperty("status").GetString());
    }

    [Fact]
    public async Task ServiceStatus_NoProbeEvents_ReturnsAnEmptyBoard()
    {
        var body = await _client.GetFromJsonAsync<JsonElement>(
            "/api/stats/service-status?from=2026-07-22T10:00:00Z&to=2026-07-22T11:00:00Z");

        Assert.Empty(body.GetProperty("services").EnumerateArray());
    }

    [Theory]
    [InlineData("/api/stats/service-status?from=2026-07-21T10:00:00Z&to=2026-07-21T11:00:00Z&staleMinutes=0")]
    [InlineData("/api/stats/service-status?from=2026-07-21T10:00:00Z&to=2026-07-21T11:00:00Z&staleMinutes=2000")]
    [InlineData("/api/stats/service-status?from=not-a-date&to=2026-07-21T11:00:00Z")]
    [InlineData("/api/stats/service-status?from=2026-07-21T10:00:00Z&to=2026-07-21T11:00:00Z&filter=%40Bogus%20%3D%201")]
    public async Task ServiceStatus_InvalidInput_Returns400(string url)
    {
        var response = await _client.GetAsync(url);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PropertyValues_ReturnsTopValuesWithCounts()
    {
        var response = await _client.GetAsync($"/api/stats/property-values?property=OrderId&{AnalysisRange}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var values = body.GetProperty("values").EnumerateArray().ToList();
        Assert.Equal(2, values.Count);
        Assert.Equal("1", values[0].GetProperty("value").GetString());
        Assert.Equal(2, values[0].GetProperty("count").GetInt64());
        Assert.Equal("2", values[1].GetProperty("value").GetString());
        Assert.Equal(1, values[1].GetProperty("count").GetInt64());
    }

    [Theory]
    [InlineData("/api/stats/property-values?property=bad%27name&from=2026-07-14T10:00:00Z&to=2026-07-14T11:00:00Z")]
    [InlineData("/api/stats/property-values?property=&from=2026-07-14T10:00:00Z&to=2026-07-14T11:00:00Z")]
    [InlineData("/api/stats/property-values?property=OrderId&from=not-a-date&to=2026-07-14T11:00:00Z")]
    public async Task PropertyValues_InvalidInput_Returns400(string url)
    {
        var response = await _client.GetAsync(url);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task SlowOperations_FlagsGroupsSlowerThanTheirBaseline()
    {
        var store = _factory.Services.GetRequiredService<IEventStore>();
        var batch = new List<Event>();
        // "Handle {Path}": baseline ~40ms (before range), current ~5000ms (in range) => regression
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T09:00:00.0000000Z", "Handle {Path}", 40 + i));
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T10:10:00.0000000Z", "Handle {Path}", 5000 + i));
        // "Burst {Path}": current all EXACTLY 8000ms (identical) => must still flag (ROW_NUMBER, not PERCENT_RANK)
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T09:00:00.0000000Z", "Burst {Path}", 50 + i));
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T10:10:00.0000000Z", "Burst {Path}", 8000));
        // "Fast {Path}": ~5ms, below floor => never flagged
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T09:00:00.0000000Z", "Fast {Path}", 4 + i));
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T10:10:00.0000000Z", "Fast {Path}", 6 + i));
        // "Steady {Path}": ~1000ms in both windows => no regression
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T09:00:00.0000000Z", "Steady {Path}", 1000 + i));
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T10:10:00.0000000Z", "Steady {Path}", 1000 + i));
        await store.WriteBatchAsync(batch);

        var response = await _client.GetAsync(
            "/api/stats/slow-operations?from=2026-07-16T10:00:00Z&to=2026-07-16T11:00:00Z&minSamples=3&floorMs=10&factor=2");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var ops = body.GetProperty("operations").EnumerateArray().ToList();
        var templates = ops.Select(o => o.GetProperty("template").GetString()).ToHashSet();
        Assert.Equal(new HashSet<string?> { "Handle {Path}", "Burst {Path}" }, templates);
        var handle = ops.Single(o => o.GetProperty("template").GetString() == "Handle {Path}");
        Assert.Equal(5, handle.GetProperty("count").GetInt64());
        Assert.True(handle.GetProperty("currentP95").GetDouble() >= handle.GetProperty("baselineP95").GetDouble() * 2);
    }

    [Fact]
    public async Task SlowOperations_ReportsTimedAndComparableCounts()
    {
        var store = _factory.Services.GetRequiredService<IEventStore>();
        var batch = new List<Event>();
        // "Cold {Path}": timed samples only in the current window, no baseline before `from`
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-17T10:10:00.0000000Z", "Cold {Path}", 100 + i));
        // "Even {Path}": timed samples in both windows, same level => comparable but not regressed
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-17T09:00:00.0000000Z", "Even {Path}", 200 + i));
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-17T10:10:00.0000000Z", "Even {Path}", 200 + i));
        // "Thin {Path}": only 2 current-window samples (below minSamples=3) => still counts as timed
        for (var i = 0; i < 2; i++) batch.Add(Timed("2026-07-17T10:10:00.0000000Z", "Thin {Path}", 300 + i));
        await store.WriteBatchAsync(batch);

        var body = await _client.GetFromJsonAsync<JsonElement>(
            "/api/stats/slow-operations?from=2026-07-17T10:00:00Z&to=2026-07-17T11:00:00Z&minSamples=3&floorMs=10&factor=2");

        Assert.Empty(body.GetProperty("operations").EnumerateArray());
        // Cold, Even and Thin all have current-window samples; timed is NOT gated by minSamples,
        // so Thin (2 < 3) is still counted
        Assert.Equal(3, body.GetProperty("timedOperationCount").GetInt64());
        // only Even has >= minSamples in BOTH windows
        Assert.Equal(1, body.GetProperty("comparableOperationCount").GetInt64());
    }

    [Theory]
    [InlineData("/api/stats/slow-operations?from=2026-07-16T10:00:00Z&to=2026-07-16T11:00:00Z&property=bad%27name")]
    [InlineData("/api/stats/slow-operations?from=2026-07-16T10:00:00Z&to=2026-07-16T11:00:00Z&factor=0.5")]
    [InlineData("/api/stats/slow-operations?from=not-a-date&to=2026-07-16T11:00:00Z")]
    public async Task SlowOperations_InvalidInput_Returns400(string url)
    {
        var response = await _client.GetAsync(url);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
