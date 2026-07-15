using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Api;

public sealed class EventEndpointsTests : IAsyncLifetime
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public EventEndpointsTests() => _client = _factory.CreateClient();

    public async Task InitializeAsync()
    {
        var store = _factory.Services.GetRequiredService<IEventStore>();
        await store.WriteBatchAsync(
        [
            Seed("2026-07-10T10:00:00.0000000Z", "Information", "app started", null, null),
            Seed("2026-07-10T11:00:00.0000000Z", "Error", "connection refused by db", """{"UserId":42}""", "System.Net.SocketException"),
            Seed("2026-07-10T12:00:00.0000000Z", "Warning", "disk 90% full", """{"UserId":7,"Elapsed":510.5}""", null),
            Seed("2026-07-10T13:00:00.0000000Z", "Error", "timeout calling orders", """{"UserId":42,"OrderId":9}""", null),
            Seed("2026-07-10T14:00:00.0000000Z", "Information", "job done 100x faster", null, null),
        ]);
    }

    public Task DisposeAsync()
    {
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private static Event Seed(string timestamp, string level, string message, string? properties, string? exception) =>
        new(0, timestamp, level, message, null, properties, exception, timestamp);

    [Fact]
    public async Task Query_NoFilter_ReturnsNewestFirst()
    {
        var page = await GetPage("/api/events");

        var messages = page.GetProperty("events").EnumerateArray()
            .Select(e => e.GetProperty("message").GetString()).ToList();
        Assert.Equal(
            ["job done 100x faster", "timeout calling orders", "disk 90% full", "connection refused by db", "app started"],
            messages);
        Assert.False(page.GetProperty("hasMore").GetBoolean());
    }

    [Fact]
    public async Task Query_LevelFilter_ReturnsOnlyMatching()
    {
        var page = await GetPage("/api/events?filter=" + Uri.EscapeDataString("@Level = 'Error'"));

        Assert.Equal(2, page.GetProperty("events").GetArrayLength());
        Assert.All(page.GetProperty("events").EnumerateArray(),
            e => Assert.Equal("Error", e.GetProperty("level").GetString()));
    }

    [Fact]
    public async Task Query_PropertyAndFreeTextFilter_UseJsonAndFts()
    {
        var byProperty = await GetPage("/api/events?filter=" + Uri.EscapeDataString("UserId = 42 and Has(OrderId)"));
        Assert.Equal("timeout calling orders",
            byProperty.GetProperty("events").EnumerateArray().Single().GetProperty("message").GetString());

        var byFreeText = await GetPage("/api/events?filter=" + Uri.EscapeDataString("'connection refused'"));
        Assert.Equal("connection refused by db",
            byFreeText.GetProperty("events").EnumerateArray().Single().GetProperty("message").GetString());
    }

    [Fact]
    public async Task Query_ContainsTreatsWildcardCharactersAsLiterals()
    {
        // if % were a wildcard, '100%' would match 'job done 100x faster' via LIKE '%100%%'
        var wildcard = await GetPage("/api/events?filter=" + Uri.EscapeDataString("@Message contains '100%'"));
        Assert.Equal(0, wildcard.GetProperty("events").GetArrayLength());

        var literal = await GetPage("/api/events?filter=" + Uri.EscapeDataString("@Message contains '90% f'"));
        Assert.Equal("disk 90% full",
            literal.GetProperty("events").EnumerateArray().Single().GetProperty("message").GetString());
    }

    [Fact]
    public async Task Query_KeysetPaging_WalksAllEventsWithoutGaps()
    {
        var first = await GetPage("/api/events?count=2");
        Assert.True(first.GetProperty("hasMore").GetBoolean());
        Assert.Equal(2, first.GetProperty("events").GetArrayLength());

        var afterId = first.GetProperty("events").EnumerateArray().Last().GetProperty("id").GetInt64();
        var second = await GetPage($"/api/events?count=2&afterId={afterId}");
        var ids = second.GetProperty("events").EnumerateArray()
            .Select(e => e.GetProperty("id").GetInt64()).ToList();
        Assert.Equal(2, ids.Count);
        Assert.All(ids, id => Assert.True(id < afterId));
    }

    [Fact]
    public async Task Query_TimeRange_UsesInclusiveBounds()
    {
        var page = await GetPage("/api/events?from=2026-07-10T11:00:00Z&to=2026-07-10T12:00:00Z");

        var messages = page.GetProperty("events").EnumerateArray()
            .Select(e => e.GetProperty("message").GetString()).ToList();
        Assert.Equal(["disk 90% full", "connection refused by db"], messages);
    }

    [Theory]
    [InlineData("/api/events?filter=%40Bogus%20%3D%201")]
    [InlineData("/api/events?count=0")]
    [InlineData("/api/events?count=1001")]
    [InlineData("/api/events?from=not-a-date")]
    public async Task Query_InvalidInput_Returns400(string url)
    {
        var response = await _client.GetAsync(url);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task GetById_ReturnsEventOr404()
    {
        var page = await GetPage("/api/events?count=1");
        var id = page.GetProperty("events").EnumerateArray().Single().GetProperty("id").GetInt64();

        var found = await _client.GetFromJsonAsync<JsonElement>($"/api/events/{id}");
        Assert.Equal("job done 100x faster", found.GetProperty("message").GetString());

        var missing = await _client.GetAsync("/api/events/999999");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task Validate_ReportsValidityAndPosition()
    {
        var valid = await Post("/api/query/validate", new { filter = "@Level = 'Error'" });
        Assert.True(valid.GetProperty("valid").GetBoolean());

        var invalid = await Post("/api/query/validate", new { filter = "@Level = " });
        Assert.False(invalid.GetProperty("valid").GetBoolean());
        Assert.Equal(9, invalid.GetProperty("position").GetInt32());
        Assert.False(string.IsNullOrEmpty(invalid.GetProperty("error").GetString()));
    }

    private async Task<JsonElement> GetPage(string url)
    {
        var response = await _client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task<JsonElement> Post(string url, object body)
    {
        var response = await _client.PostAsJsonAsync(url, body);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
}
