using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using LogHarbor.Core.Archiving;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Api;

public sealed class ArchiveEndpointsTests : IAsyncLifetime
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-13T12:00:00Z");

    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public ArchiveEndpointsTests() => _client = _factory.CreateClient();

    public async Task InitializeAsync()
    {
        var store = _factory.Services.GetRequiredService<IEventStore>();
        await store.WriteBatchAsync(
        [
            new Event(0, "2026-03-01T10:00:00.0000000Z", "Error", "archived error", null, null, null,
                "2026-03-01T10:00:01.0000000Z"),
            new Event(0, "2026-03-01T11:00:00.0000000Z", "Information", "archived info", null, null, null,
                "2026-03-01T11:00:01.0000000Z"),
            new Event(0, "2026-07-12T10:00:00.0000000Z", "Information", "hot event", null, null, null,
                "2026-07-12T10:00:01.0000000Z"),
        ]);
    }

    public Task DisposeAsync()
    {
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private Task<IReadOnlyList<ArchiveSegment>> RunArchiveAsync() =>
        _factory.Services.GetRequiredService<Archiver>().RunArchiveAsync(Now);

    [Fact]
    public async Task Segments_EmptyWithoutArchive_ListsSegmentAfterArchiveRun()
    {
        var empty = await _client.GetFromJsonAsync<JsonElement>("/api/archive/segments");
        Assert.Equal(0, empty.GetArrayLength());

        await RunArchiveAsync();

        var segments = await _client.GetFromJsonAsync<JsonElement>("/api/archive/segments");
        var segment = segments.EnumerateArray().Single();
        Assert.Equal("2026-03-01", segment.GetProperty("day").GetString());
        Assert.Equal("cold", segment.GetProperty("status").GetString());
        Assert.Equal(2, segment.GetProperty("eventCount").GetInt64());
        Assert.True(segment.GetProperty("sizeBytes").GetInt64() > 0);
        Assert.True(segment.GetProperty("uncompressedBytes").GetInt64() > 0);
    }

    [Fact]
    public async Task Events_RangeTouchingColdSegment_IncludesArchivedDays()
    {
        await RunArchiveAsync();

        var page = await _client.GetFromJsonAsync<JsonElement>("/api/events");

        Assert.Equal(["2026-03-01"],
            page.GetProperty("archivedDays").EnumerateArray().Select(day => day.GetString()));
        Assert.Equal(["hot event"],
            page.GetProperty("events").EnumerateArray().Select(e => e.GetProperty("message").GetString()));
    }

    [Fact]
    public async Task HydrateFlow_MakesArchivedEventsSearchableAgain()
    {
        await RunArchiveAsync();

        var accepted = await _client.PostAsJsonAsync("/api/archive/hydrate",
            new { from = "2026-03-01T00:00:00Z", to = "2026-03-02T00:00:00Z" });
        Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);
        var body = await accepted.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Single(body.GetProperty("segments").EnumerateArray());

        await WaitForStatusAsync("2026-03-01", "hydrated");

        var page = await _client.GetFromJsonAsync<JsonElement>("/api/events");
        Assert.Equal(0, page.GetProperty("archivedDays").GetArrayLength());
        Assert.Equal(["hot event", "archived info", "archived error"],
            page.GetProperty("events").EnumerateArray().Select(e => e.GetProperty("message").GetString()));
    }

    [Fact]
    public async Task Hydrate_MissingBounds_Returns400()
    {
        var response = await _client.PostAsJsonAsync("/api/archive/hydrate", new { from = "2026-03-01T00:00:00Z" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task HydrateStatus_InvalidTimestamp_Returns400()
    {
        var response = await _client.GetAsync("/api/archive/hydrate/status?from=not-a-date");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ArchiveSettings_GetReturnsDefaults_PutPersists()
    {
        var defaults = await _client.GetFromJsonAsync<JsonElement>("/api/settings/archive");
        Assert.Equal(90, defaults.GetProperty("compressAfterDays").GetInt32());
        Assert.Equal(1, defaults.GetProperty("hydrationKeepDays").GetInt32());
        Assert.Equal(365, defaults.GetProperty("retentionDays").GetInt32());

        var put = await _client.PutAsJsonAsync("/api/settings/archive",
            new { compressAfterDays = 30, hydrationKeepDays = 2, retentionDays = 180 });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var saved = await _client.GetFromJsonAsync<JsonElement>("/api/settings/archive");
        Assert.Equal(30, saved.GetProperty("compressAfterDays").GetInt32());
        Assert.Equal(2, saved.GetProperty("hydrationKeepDays").GetInt32());
        Assert.Equal(180, saved.GetProperty("retentionDays").GetInt32());
    }

    [Theory]
    [InlineData(-1, 1, 365)]
    [InlineData(90, 0, 365)]
    [InlineData(90, 1, 0)]
    public async Task ArchiveSettings_InvalidValues_Return400(int compress, int keep, int retention)
    {
        var response = await _client.PutAsJsonAsync("/api/settings/archive",
            new { compressAfterDays = compress, hydrationKeepDays = keep, retentionDays = retention });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private async Task WaitForStatusAsync(string day, string expected)
    {
        var url = $"/api/archive/hydrate/status?from={day}T00:00:00Z&to={day}T23:59:59Z";
        var deadline = DateTimeOffset.UtcNow.AddSeconds(10);
        while (true)
        {
            var status = await _client.GetFromJsonAsync<JsonElement>(url);
            var segment = status.GetProperty("segments").EnumerateArray()
                .SingleOrDefault(s => s.GetProperty("day").GetString() == day);
            if (segment.ValueKind == JsonValueKind.Object && segment.GetProperty("status").GetString() == expected)
            {
                return;
            }
            Assert.True(DateTimeOffset.UtcNow < deadline, $"segment {day} never reached status '{expected}'");
            await Task.Delay(50);
        }
    }
}
