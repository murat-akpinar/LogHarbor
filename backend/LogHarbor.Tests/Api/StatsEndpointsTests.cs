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
        // no colon anywhere: the whole first line is the type
        Assert.Equal("CustomFailure", exceptions[1].GetProperty("type").GetString());
        Assert.Equal(1, exceptions[1].GetProperty("count").GetInt64());
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
