using System.Net;

namespace LogHarbor.Tests.Api;

/// <summary>
/// The headers have to be on every response, not on the one that was checked by hand. Middleware
/// order is what decides that, and it is easy to get a policy onto the API while the static bundle
/// — the document that actually runs the JavaScript — goes out bare.
/// </summary>
public sealed class SecurityHeadersTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public SecurityHeadersTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private static void AssertBaseline(HttpResponseMessage response)
    {
        Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
        Assert.Equal("no-referrer", Assert.Single(response.Headers.GetValues("Referrer-Policy")));
        Assert.Equal("DENY", Assert.Single(response.Headers.GetValues("X-Frame-Options")));
        var csp = Assert.Single(response.Headers.GetValues("Content-Security-Policy"));
        Assert.Contains("frame-ancestors 'none'", csp);
        Assert.Contains("object-src 'none'", csp);
        Assert.Contains("base-uri 'self'", csp);
        // index.css paints its grain with a data: svg background; without this the page loses it
        Assert.Contains("img-src 'self' data:", csp);
    }

    [Theory]
    // the SPA document, an API answer, an unauthorised answer, and a miss: a header that only
    // rides on the happy path is not a policy
    [InlineData("/")]
    [InlineData("/api/signals")]
    [InlineData("/api/events?from=2026-07-16T10:00:00Z&to=2026-07-16T11:00:00Z")]
    [InlineData("/api/definitely-not-a-route")]
    public async Task EveryResponseCarriesTheHeaders(string path)
    {
        AssertBaseline(await _client.GetAsync(path));
    }

    [Fact]
    public async Task TheDefaultPolicyAllowsNoInlineScript()
    {
        var response = await _client.GetAsync("/");
        var csp = Assert.Single(response.Headers.GetValues("Content-Security-Policy"));

        // the bundle is a plain <script src>, so there is nothing to grandfather — and the one
        // value that would make the whole policy decorative is the one to pin
        Assert.DoesNotContain("unsafe-inline", csp);
        Assert.DoesNotContain("unsafe-eval", csp);
        Assert.StartsWith("default-src 'self'", csp);
    }

    [Fact]
    public async Task SwaggerGetsItsOwnPolicy_RatherThanAHoleInEveryoneElses()
    {
        // Swagger UI ships inline script and style; it is admin-only and its own document, and
        // the header lands before the session gate, so an anonymous 401 still shows the policy
        var swagger = await _client.GetAsync("/swagger/index.html");
        var csp = Assert.Single(swagger.Headers.GetValues("Content-Security-Policy"));

        Assert.Contains("script-src 'self' 'unsafe-inline'", csp);
        Assert.Contains("frame-ancestors 'none'", csp);
    }

    [Fact]
    public async Task TheServerBannerIsGone()
    {
        var response = await _client.GetAsync("/healthz");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(response.Headers.Contains("Server"));
    }
}
