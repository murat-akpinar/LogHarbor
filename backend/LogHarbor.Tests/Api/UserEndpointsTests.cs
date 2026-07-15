using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace LogHarbor.Tests.Api;

public sealed class UserEndpointsTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();

    private HttpClient NewClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

    public void Dispose() => _factory.Dispose();

    private static async Task LoginAsync(HttpClient client, string username, string password)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static Task<HttpResponseMessage> CreateUserAsync(
        HttpClient client, string username, string password, string role) =>
        client.PostAsJsonAsync("/api/users", new { username, password, role });

    [Fact]
    public async Task Bootstrap_FirstUserMustBeAdmin_AndEnablesAuth()
    {
        var client = NewClient();

        // no users yet: the API is open and the first account must be an admin
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/users")).StatusCode);
        var viewerFirst = await CreateUserAsync(client, "eve", "password123", "viewer");
        Assert.Equal(HttpStatusCode.BadRequest, viewerFirst.StatusCode);

        var adminFirst = await CreateUserAsync(client, "alice", "password123", "admin");
        Assert.Equal(HttpStatusCode.Created, adminFirst.StatusCode);

        // auth is now on: the same (cookieless-session) client is locked out until it logs in
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/users")).StatusCode);
        await LoginAsync(client, "alice", "password123");
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/users")).StatusCode);
    }

    [Fact]
    public async Task Viewer_IsReadOnly_AndCannotManageUsers()
    {
        var admin = NewClient();
        Assert.Equal(HttpStatusCode.Created, (await CreateUserAsync(admin, "alice", "password123", "admin")).StatusCode);
        await LoginAsync(admin, "alice", "password123");
        Assert.Equal(HttpStatusCode.Created, (await CreateUserAsync(admin, "bob", "password123", "viewer")).StatusCode);

        var viewer = NewClient();
        await LoginAsync(viewer, "bob", "password123");

        // reads and filter validation stay available
        Assert.Equal(HttpStatusCode.OK, (await viewer.GetAsync("/api/events")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await viewer.GetAsync("/api/signals")).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await viewer.PostAsJsonAsync("/api/query/validate", new { filter = "@Level = 'Error'" })).StatusCode);

        // mutations and user management are admin-only
        Assert.Equal(HttpStatusCode.Forbidden,
            (await viewer.PostAsJsonAsync("/api/signals", new { title = "x", filter = "@Level = 'Error'" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.GetAsync("/api/users")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await CreateUserAsync(viewer, "mallory", "password123", "admin")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await viewer.PutAsJsonAsync("/api/settings/archive",
                new { compressAfterDays = 1, hydrationKeepDays = 1, retentionDays = 1 })).StatusCode);
    }

    [Fact]
    public async Task LastAdmin_CannotBeDeleted()
    {
        var admin = NewClient();
        var created = await CreateUserAsync(admin, "alice", "password123", "admin");
        var adminId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();
        await LoginAsync(admin, "alice", "password123");

        var blocked = await admin.DeleteAsync($"/api/users/{adminId}");
        Assert.Equal(HttpStatusCode.BadRequest, blocked.StatusCode);

        // with a second admin present the first one can go
        Assert.Equal(HttpStatusCode.Created, (await CreateUserAsync(admin, "carol", "password123", "admin")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/users/{adminId}")).StatusCode);
    }

    [Theory]
    [InlineData("", "password123", "admin")]
    [InlineData("bad name", "password123", "admin")]
    [InlineData("alice", "short", "admin")]
    [InlineData("alice", "password123", "root")]
    public async Task Create_InvalidInput_Returns400(string username, string password, string role)
    {
        var client = NewClient();

        var response = await CreateUserAsync(client, username, password, role);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_DuplicateUsername_Returns400()
    {
        var client = NewClient();
        Assert.Equal(HttpStatusCode.Created, (await CreateUserAsync(client, "alice", "password123", "admin")).StatusCode);
        await LoginAsync(client, "alice", "password123");

        var duplicate = await CreateUserAsync(client, "ALICE", "password456", "viewer");

        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
    }
}
