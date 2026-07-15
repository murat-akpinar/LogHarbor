using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace LogHarbor.Tests.Api;

public sealed class AuthDisabledTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public AuthDisabledTests() => _client = _factory.CreateClient();

    [Fact]
    public async Task Status_ReportsAuthNotRequired()
    {
        var status = await _client.GetFromJsonAsync<JsonElement>("/api/auth/status");

        Assert.False(status.GetProperty("authRequired").GetBoolean());
        Assert.True(status.GetProperty("authenticated").GetBoolean());
    }

    [Fact]
    public async Task ManagementApi_IsOpen()
    {
        var response = await _client.GetAsync("/api/signals");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Login_WhenAuthDisabled_Returns400()
    {
        var response = await _client.PostAsJsonAsync("/api/auth/login", new { password = "anything" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    public void Dispose() => _factory.Dispose();
}

public sealed class AuthEnabledTests : IDisposable
{
    private const string Password = "correct horse battery staple";

    private readonly LogHarborApiFactory _factory = new(Password);
    private readonly HttpClient _client;

    public AuthEnabledTests() =>
        _client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            HandleCookies = true,
        });

    [Fact]
    public async Task Status_BeforeLogin_ReportsUnauthenticated()
    {
        var status = await _client.GetFromJsonAsync<JsonElement>("/api/auth/status");

        Assert.True(status.GetProperty("authRequired").GetBoolean());
        Assert.False(status.GetProperty("authenticated").GetBoolean());
    }

    [Theory]
    [InlineData("/api/signals")]
    [InlineData("/api/events")]
    [InlineData("/api/apikeys")]
    [InlineData("/api/stats/summary?from=2026-07-13T10:00:00Z&to=2026-07-13T11:00:00Z")]
    public async Task ManagementApi_WithoutSession_Returns401(string url)
    {
        var response = await _client.GetAsync(url);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Healthz_StaysOpen()
    {
        var response = await _client.GetAsync("/healthz");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Ingestion_StaysOpenToApiKeys_NotSessions()
    {
        // no session cookie: ingestion must still authenticate by API key alone
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw")
        {
            Content = new StringContent(
                """{"@t":"2026-07-13T10:00:00Z","@l":"Information","@m":"via api key"}""",
                Encoding.UTF8,
                "application/vnd.serilog.clef"),
        };
        request.Headers.Add("X-LogHarbor-ApiKey", "not-a-real-key");

        var response = await _client.SendAsync(request);

        // 401 from the API-key check, not from the session check
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Missing or invalid API key", problem.GetProperty("title").GetString());
    }

    [Fact]
    public async Task Login_WrongPassword_Returns401_AndGrantsNoAccess()
    {
        var response = await _client.PostAsJsonAsync("/api/auth/login",
            new { username = "admin", password = "wrong" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/api/signals")).StatusCode);
    }

    [Fact]
    public async Task Login_UnknownUsername_Returns401()
    {
        var response = await _client.PostAsJsonAsync("/api/auth/login",
            new { username = "nobody", password = Password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_SeededAdmin_GrantsAccess_AndLogoutRevokesIt()
    {
        // LOGHARBOR_ADMIN_PASSWORD seeds the 'admin' user on first startup
        var login = await _client.PostAsJsonAsync("/api/auth/login",
            new { username = "admin", password = Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);

        var status = await _client.GetFromJsonAsync<JsonElement>("/api/auth/status");
        Assert.True(status.GetProperty("authenticated").GetBoolean());
        Assert.Equal("admin", status.GetProperty("username").GetString());
        Assert.Equal("admin", status.GetProperty("role").GetString());
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/api/signals")).StatusCode);

        var logout = await _client.PostAsync("/api/auth/logout", content: null);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/api/signals")).StatusCode);
    }

    [Fact]
    public async Task Login_RepeatedFailures_EventuallyRateLimited()
    {
        var statuses = new List<HttpStatusCode>();
        for (var attempt = 0; attempt < LogHarborApiFactory.LoginRateLimitPerMinute + 2; attempt++)
        {
            var response = await _client.PostAsJsonAsync("/api/auth/login",
                new { username = "admin", password = "wrong" });
            statuses.Add(response.StatusCode);
        }

        Assert.Contains(HttpStatusCode.TooManyRequests, statuses);
    }

    [Fact]
    public async Task ConfiguredPassword_DoesNotForceAChange()
    {
        var login = await _client.PostAsJsonAsync("/api/auth/login",
            new { username = "admin", password = Password });

        var body = await login.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.GetProperty("mustChangePassword").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/api/signals")).StatusCode);
    }

    [Fact]
    public async Task ChangePassword_ReplacesTheOldOne()
    {
        await _client.PostAsJsonAsync("/api/auth/login", new { username = "admin", password = Password });

        var change = await _client.PostAsJsonAsync("/api/auth/password",
            new { currentPassword = Password, newPassword = "a brand new password" });
        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);

        await _client.PostAsync("/api/auth/logout", content: null);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.PostAsJsonAsync("/api/auth/login",
            new { username = "admin", password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _client.PostAsJsonAsync("/api/auth/login",
            new { username = "admin", password = "a brand new password" })).StatusCode);
    }

    [Fact]
    public async Task ChangePassword_WithoutSession_Returns401()
    {
        var response = await _client.PostAsJsonAsync("/api/auth/password",
            new { currentPassword = Password, newPassword = "a brand new password" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_WithWrongCurrentPassword_Returns401()
    {
        await _client.PostAsJsonAsync("/api/auth/login", new { username = "admin", password = Password });

        var response = await _client.PostAsJsonAsync("/api/auth/password",
            new { currentPassword = "not it", newPassword = "a brand new password" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_TooShort_Returns400()
    {
        await _client.PostAsJsonAsync("/api/auth/login", new { username = "admin", password = Password });

        var response = await _client.PostAsJsonAsync("/api/auth/password",
            new { currentPassword = Password, newPassword = "short" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    public void Dispose() => _factory.Dispose();
}

/// <summary>No environment at all: first start seeds admin/admin, locked to a password change.</summary>
public sealed class DefaultAdminSeedTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new(seedDefaultAdmin: true);
    private readonly HttpClient _client;

    public DefaultAdminSeedTests() =>
        _client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            HandleCookies = true,
        });

    private Task<HttpResponseMessage> LoginAsync(string password) =>
        _client.PostAsJsonAsync("/api/auth/login", new { username = "admin", password });

    [Fact]
    public async Task AuthIsRequired_WithNoConfiguration()
    {
        var status = await _client.GetFromJsonAsync<JsonElement>("/api/auth/status");

        Assert.True(status.GetProperty("authRequired").GetBoolean());
        Assert.False(status.GetProperty("authenticated").GetBoolean());
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/api/signals")).StatusCode);
    }

    [Fact]
    public async Task DefaultLogin_Succeeds_ButEveryOtherEndpointIsRefusedUntilTheChange()
    {
        var login = await LoginAsync("admin");
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var body = await login.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("mustChangePassword").GetBoolean());

        var status = await _client.GetFromJsonAsync<JsonElement>("/api/auth/status");
        Assert.True(status.GetProperty("mustChangePassword").GetBoolean());

        var blocked = await _client.GetAsync("/api/signals");
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        var problem = await blocked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Password change required", problem.GetProperty("title").GetString());
    }

    [Fact]
    public async Task ChangingThePassword_UnlocksTheApi_AndRetiresTheDefault()
    {
        await LoginAsync("admin");

        var change = await _client.PostAsJsonAsync("/api/auth/password",
            new { currentPassword = "admin", newPassword = "a proper password" });
        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);

        // same session, no re-login: the cookie was re-issued without the must-change claim
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/api/signals")).StatusCode);
        var status = await _client.GetFromJsonAsync<JsonElement>("/api/auth/status");
        Assert.False(status.GetProperty("mustChangePassword").GetBoolean());

        await _client.PostAsync("/api/auth/logout", content: null);
        Assert.Equal(HttpStatusCode.Unauthorized, (await LoginAsync("admin")).StatusCode);
    }

    [Fact]
    public async Task Ingestion_IsNotBlockedByTheSeededAdmin()
    {
        // API keys cannot be created yet, but the ingestion gate must still be the key check,
        // not the password-change gate
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw")
        {
            Content = new StringContent(
                """{"@t":"2026-07-13T10:00:00Z","@m":"via api key"}""",
                Encoding.UTF8,
                "application/vnd.serilog.clef"),
        };
        request.Headers.Add("X-LogHarbor-ApiKey", "not-a-real-key");

        var response = await _client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Missing or invalid API key", problem.GetProperty("title").GetString());
    }

    public void Dispose() => _factory.Dispose();
}
