using System.Net.Http.Headers;

namespace LogHarbor.Tests.Api;

/// <summary>
/// How the SPA reaches the browser: compressed, and cached exactly as long as it is safe to.
/// Both were missing until 2026-07-31 — the bundle crossed the wire raw on every load, and every
/// file was revalidated on every visit. The built bundle is committed to wwwroot, so these assert
/// against the real one rather than a fixture.
/// </summary>
public sealed class StaticAssetDeliveryTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    // no AutomaticDecompression: it would unwrap the response before the assertions could see it
    public StaticAssetDeliveryTests() => _client = _factory.CreateClient();

    /// <summary>The hashed name of a real asset, read out of the served index.html.</summary>
    private async Task<string> FindAssetAsync()
    {
        var html = await _client.GetStringAsync("/");
        var start = html.IndexOf("/assets/", StringComparison.Ordinal);
        Assert.True(start >= 0, "index.html names no /assets/ file — is the SPA built into wwwroot?");
        var end = html.IndexOfAny(['"', '\''], start);
        Assert.True(end > start, "the asset reference in index.html is unterminated");
        return html[start..end];
    }

    [Fact]
    public async Task Assets_AreCompressed_WhenTheClientTakesThem()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, await FindAssetAsync());
        request.Headers.AcceptEncoding.Add(new StringWithQualityHeaderValue("gzip"));

        var response = await _client.SendAsync(request);

        Assert.Contains("gzip", response.Content.Headers.ContentEncoding);
        // without this a shared cache could hand the compressed copy to a client that cannot read it
        Assert.Contains("Accept-Encoding", response.Headers.Vary);
    }

    [Fact]
    public async Task Assets_AreSentWhole_ToAClientThatTakesNoEncoding()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, await FindAssetAsync());
        request.Headers.AcceptEncoding.Clear();

        var response = await _client.SendAsync(request);

        Assert.Empty(response.Content.Headers.ContentEncoding);
    }

    [Fact]
    public async Task Assets_AreKeptForAYear_BecauseTheirNamesHoldTheBuildHash()
    {
        var response = await _client.GetAsync(await FindAssetAsync());

        var cacheControl = response.Headers.CacheControl;
        Assert.NotNull(cacheControl);
        Assert.True(cacheControl.Public);
        Assert.Equal(TimeSpan.FromDays(365), cacheControl.MaxAge);
    }

    [Theory]
    [InlineData("/")]
    // a deep link is served index.html by the fallback rather than by the static-file middleware,
    // and it needs the same treatment: this is the file that names the current bundle hashes, so a
    // cached copy would pin the reader to the previous deploy
    [InlineData("/requests")]
    public async Task IndexHtml_IsNeverCached_OrADeployWouldNeverArrive(string url)
    {
        var response = await _client.GetAsync(url);

        response.EnsureSuccessStatusCode();
        var cacheControl = response.Headers.CacheControl;
        Assert.NotNull(cacheControl);
        Assert.True(cacheControl.NoCache);
        Assert.Null(cacheControl.MaxAge);
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }
}
