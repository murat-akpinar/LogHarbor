using System.Net;

namespace LogHarbor.Tests.Api;

public sealed class FallbackTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public FallbackTests() => _client = _factory.CreateClient();

    [Theory]
    [InlineData("/api/does-not-exist")]
    [InlineData("/hubs/does-not-exist")]
    public async Task UnknownApiPath_Returns404_NotTheSpa(string url)
    {
        var response = await _client.GetAsync(url);

        // serving index.html with a 200 here would hide typos and broken integrations
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.DoesNotContain("text/html", response.Content.Headers.ContentType?.MediaType ?? "");
    }

    public void Dispose() => _factory.Dispose();
}
