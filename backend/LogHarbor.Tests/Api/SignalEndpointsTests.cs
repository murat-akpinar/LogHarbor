using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace LogHarbor.Tests.Api;

public sealed class SignalEndpointsTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public SignalEndpointsTests() => _client = _factory.CreateClient();

    [Fact]
    public async Task Create_ValidSignal_Returns201AndIsListed()
    {
        var response = await _client.PostAsJsonAsync("/api/signals", new { title = "Errors", filter = "@Level = 'Error'" });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Errors", created.GetProperty("title").GetString());

        var listed = await _client.GetFromJsonAsync<JsonElement>("/api/signals");
        Assert.Equal("Errors", listed.EnumerateArray().Single().GetProperty("title").GetString());
    }

    [Fact]
    public async Task Create_WithoutTitle_Returns400()
    {
        var response = await _client.PostAsJsonAsync("/api/signals", new { title = "  ", filter = "A = 1" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_WithoutFilter_Returns400()
    {
        var response = await _client.PostAsJsonAsync("/api/signals", new { title = "Errors", filter = "  " });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_InvalidFilter_Returns400WithPosition()
    {
        var response = await _client.PostAsJsonAsync("/api/signals", new { title = "Bad", filter = "@Bogus = 1" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("unknown built-in field", problem.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task Create_DuplicateTitle_Returns400()
    {
        await _client.PostAsJsonAsync("/api/signals", new { title = "Errors", filter = "@Level = 'Error'" });

        var response = await _client.PostAsJsonAsync("/api/signals", new { title = "Errors", filter = "@Level = 'Fatal'" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Update_ExistingSignal_Returns200WithChanges()
    {
        var created = await (await _client.PostAsJsonAsync("/api/signals", new { title = "Errors", filter = "@Level = 'Error'" }))
            .Content.ReadFromJsonAsync<JsonElement>();

        var response = await _client.PutAsJsonAsync(
            $"/api/signals/{created.GetProperty("id").GetInt64()}",
            new { title = "Renamed", filter = "@Level = 'Fatal'" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Renamed", updated.GetProperty("title").GetString());
    }

    [Fact]
    public async Task Update_UnknownId_Returns404()
    {
        var response = await _client.PutAsJsonAsync("/api/signals/999", new { title = "x", filter = "A = 1" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_ExistingSignal_Returns204()
    {
        var created = await (await _client.PostAsJsonAsync("/api/signals", new { title = "Errors", filter = "@Level = 'Error'" }))
            .Content.ReadFromJsonAsync<JsonElement>();

        var response = await _client.DeleteAsync($"/api/signals/{created.GetProperty("id").GetInt64()}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var listed = await _client.GetFromJsonAsync<JsonElement>("/api/signals");
        Assert.Empty(listed.EnumerateArray());
    }

    [Fact]
    public async Task Delete_UnknownId_Returns404()
    {
        var response = await _client.DeleteAsync("/api/signals/999");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    public void Dispose() => _factory.Dispose();
}
