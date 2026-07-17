using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace LogHarbor.Tests.Api;

public sealed class SwaggerGateTests : IDisposable
{
    private readonly List<LogHarborApiFactory> _factories = [];

    private LogHarborApiFactory NewFactory(string? environment = null)
    {
        var factory = new LogHarborApiFactory(environment: environment);
        _factories.Add(factory);
        return factory;
    }

    private static HttpClient NewClient(LogHarborApiFactory factory) =>
        factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

    public void Dispose()
    {
        foreach (var factory in _factories)
        {
            factory.Dispose();
        }
    }

    private static async Task LoginAsync(HttpClient client, string username, string password)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task SwaggerJson_IsServed_InProduction()
    {
        var client = NewClient(NewFactory(environment: "Production"));

        var response = await client.GetAsync("/swagger/v1/swagger.json");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("openapi", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Swagger_IsAdminOnly_OnceAuthIsEnabled()
    {
        var factory = NewFactory();
        var admin = NewClient(factory);
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync(
            "/api/users", new { username = "alice", password = "password123", role = "admin" })).StatusCode);
        await LoginAsync(admin, "alice", "password123");
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync(
            "/api/users", new { username = "bob", password = "password123", role = "viewer" })).StatusCode);

        var anonymous = NewClient(factory);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await anonymous.GetAsync("/swagger/v1/swagger.json")).StatusCode);

        var viewer = NewClient(factory);
        await LoginAsync(viewer, "bob", "password123");
        Assert.Equal(HttpStatusCode.Forbidden,
            (await viewer.GetAsync("/swagger/v1/swagger.json")).StatusCode);

        // the UI page and the spec both open for an admin session
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/swagger")).StatusCode);
        Assert.Equal("application/json",
            (await admin.GetAsync("/swagger/v1/swagger.json")).Content.Headers.ContentType?.MediaType);
    }
}
