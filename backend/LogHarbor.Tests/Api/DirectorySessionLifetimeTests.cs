using System.Net;
using System.Net.Http.Json;
using LogHarbor.Api.Endpoints;
using LogHarbor.Core.Auth;
using LogHarbor.Core.Storage;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace LogHarbor.Tests.Api;

/// <summary>
/// A directory principal's role is whatever the directory said at sign-in, and LogHarbor cannot
/// ask again — it binds as the person signing in and keeps no password, so re-reading group
/// membership would need a stored service credential this product does not have. The session
/// expiring is therefore the entire mechanism by which somebody removed from the admin group
/// stops being an admin here.
///
/// <para>Which is why it has to actually expire. The cookie scheme slides, so before this the
/// window was not seven days, it was forever: any open tab renewed the ticket past its own
/// deadline, and a revoked admin kept the role for as long as they left a page open.</para>
/// </summary>
public sealed class DirectorySessionLifetimeTests : IAsyncLifetime
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly StubDirectory _directory = new();
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _client = _factory
            .WithWebHostBuilder(builder => builder.ConfigureServices(services =>
                services.AddSingleton<ILdapAuthenticator>(_directory)))
            .CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

        await _factory.Services.GetRequiredService<ISettingsStore>().SaveLdapSettingsAsync(new LdapSettings
        {
            Enabled = true,
            Host = "directory.test",
            Port = 389,
            Security = LdapSecurity.None,
            BaseDn = "dc=test,dc=local",
            UserDnPattern = "uid={0},ou=users,dc=test,dc=local",
        });
        _factory.Services.GetRequiredService<LogHarbor.Api.Auth.AuthService>().Invalidate();
    }

    public Task DisposeAsync()
    {
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private async Task<System.Net.Http.Headers.HttpResponseHeaders> LoginAsync(object body)
    {
        var response = await _client.PostAsJsonAsync("/api/auth/login", body);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return response.Headers;
    }

    private static string SessionCookie(System.Net.Http.Headers.HttpResponseHeaders headers) =>
        Assert.Single(headers.GetValues("Set-Cookie"), c => c.StartsWith("logharbor_session="));

    [Fact]
    public async Task ADirectorySession_CarriesADeadline()
    {
        var headers = await LoginAsync(new { username = "alice", password = "whatever", method = "ldap" });

        var cookie = SessionCookie(headers);
        var expires = System.Text.RegularExpressions.Regex.Match(cookie, @"expires=([^;]+)",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        Assert.True(expires.Success, $"no expiry on a directory session: {cookie}");

        var deadline = DateTimeOffset.Parse(expires.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
        var window = deadline - DateTimeOffset.UtcNow;
        // the configured working day, give or take the time this test took to run
        Assert.InRange(
            window,
            AuthEndpoints.DirectorySessionLifetime - TimeSpan.FromMinutes(5),
            AuthEndpoints.DirectorySessionLifetime + TimeSpan.FromMinutes(1));
    }

    [Fact]
    public async Task ALocalSession_IsLeftAlone()
    {
        // straight into the store: enabling LDAP above turned authentication on, so POST
        // /api/users would need a session, and the session is what this test is about
        await _factory.Services.GetRequiredService<IUserStore>()
            .CreateAsync("bob", "password123", UserRole.Admin, mustChangePassword: false);

        var headers = await LoginAsync(new { username = "bob", password = "password123" });

        // a browser-session cookie, as before: a local account's revocation is the users table,
        // which lands on the next request, so there is nothing here for a deadline to buy
        Assert.DoesNotContain("expires=", SessionCookie(headers), StringComparison.OrdinalIgnoreCase);
    }

    private sealed class StubDirectory : ILdapAuthenticator
    {
        public Task<LdapAuthResult> AuthenticateAsync(
            LdapSettings settings, string username, string password,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(LdapAuthResult.Success(
                UserRole.Admin, ["cn=logharbor-admin,ou=groups,dc=test,dc=local"]));
    }
}
