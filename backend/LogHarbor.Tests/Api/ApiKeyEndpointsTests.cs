using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace LogHarbor.Tests.Api;

public sealed class ApiKeyEndpointsTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public ApiKeyEndpointsTests() => _client = _factory.CreateClient();

    [Fact]
    public async Task Create_ReturnsTokenOnce_ListNeverReturnsTokens()
    {
        var createResponse = await _client.PostAsJsonAsync("/api/apikeys", new { title = "OrderService" });

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.StartsWith("logharbor_", created.GetProperty("token").GetString());

        var listed = await _client.GetFromJsonAsync<JsonElement>("/api/apikeys");
        var key = listed.EnumerateArray().Single();
        Assert.Equal("OrderService", key.GetProperty("title").GetString());
        Assert.True(key.GetProperty("isActive").GetBoolean());
        Assert.False(key.TryGetProperty("token", out _));
    }

    [Fact]
    public async Task Create_WithoutTitle_Returns400()
    {
        var response = await _client.PostAsJsonAsync("/api/apikeys", new { title = "  " });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Delete_RevokesKey()
    {
        var created = await (await _client.PostAsJsonAsync("/api/apikeys", new { title = "svc" }))
            .Content.ReadFromJsonAsync<JsonElement>();

        var deleteResponse = await _client.DeleteAsync($"/api/apikeys/{created.GetProperty("id").GetInt64()}");

        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);
        var listed = await _client.GetFromJsonAsync<JsonElement>("/api/apikeys");
        Assert.False(listed.EnumerateArray().Single().GetProperty("isActive").GetBoolean());
    }

    public void Dispose() => _factory.Dispose();
}
