using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Api;

public sealed class TraceEndpointsTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public TraceEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task GetTrace_ReturnsSpans()
    {
        var store = _factory.Services.GetRequiredService<ISpanStore>();
        await store.WriteBatchAsync(
        [
            new Span(0, "aaaa", "s1", null, "root", "server", "checkout",
                "2026-07-18T10:00:00.0000000Z", 20, "ok", null, null, "2026-07-18T10:00:00.0000000Z"),
        ]);

        var page = await _client.GetFromJsonAsync<JsonElement>("/api/traces/aaaa");

        var span = page.GetProperty("spans").EnumerateArray().Single();
        Assert.Equal("s1", span.GetProperty("spanId").GetString());
        Assert.Equal("root", span.GetProperty("name").GetString());
        Assert.Equal(20, span.GetProperty("durationMs").GetDouble());
    }

    [Fact]
    public async Task GetTrace_UnknownId_ReturnsEmpty()
    {
        var page = await _client.GetFromJsonAsync<JsonElement>("/api/traces/nope");
        Assert.Empty(page.GetProperty("spans").EnumerateArray());
    }
}
