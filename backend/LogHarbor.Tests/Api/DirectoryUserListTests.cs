using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using LogHarbor.Core.Auth;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Api;

/// <summary>
/// Asked for on 2026-08-01: someone who signs in through the directory should turn up in the
/// user list, marked as a directory sign-in, with the date they last came in.
///
/// What it must NOT become is an account: the row grants nothing, and the directory is still
/// asked at every sign-in (docs/ldap.md).
/// </summary>
public sealed class DirectoryUserListTests : IAsyncLifetime
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly StubDirectory _directory = new();
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _client = _factory
            .WithWebHostBuilder(builder => builder.ConfigureServices(services =>
                services.AddSingleton<ILdapAuthenticator>(_directory)))
            .CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

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

    private async Task SignInAsync(string username)
    {
        var response = await _client.PostAsJsonAsync("/api/auth/login",
            new { username, password = "whatever", method = "ldap" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private async Task<JsonElement> FindAsync(string username)
    {
        var response = await _client.GetAsync("/api/users");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var users = (await response.Content.ReadFromJsonAsync<List<JsonElement>>())!;
        return users.Single(user => user.GetProperty("username").GetString() == username);
    }

    [Fact]
    public async Task ADirectorySignIn_ShowsUpInTheList_MarkedAsOne()
    {
        await SignInAsync("hermione");

        var user = await FindAsync("hermione");

        Assert.Equal("ldap", user.GetProperty("source").GetString());
        Assert.Equal(UserRole.Admin, user.GetProperty("role").GetString());
        Assert.False(string.IsNullOrEmpty(user.GetProperty("lastLoginAt").GetString()));
        // nothing to edit or delete here: access is granted and taken away in the directory
        Assert.Equal(JsonValueKind.Null, user.GetProperty("id").ValueKind);
    }

    // read through the store, not the API: the second sign-in is deliberately a *viewer*, and a
    // viewer cannot list users — which is the point of re-reading the directory every time
    [Fact]
    public async Task SigningInAgain_MovesTheDateAndTheRole_ButNotTheFirstSeen()
    {
        var store = _factory.Services.GetRequiredService<IUserStore>();
        await SignInAsync("hermione");
        var first = Assert.Single(await store.ListDirectoryAsync());

        _directory.Role = UserRole.Viewer;   // moved between groups in the directory
        await Task.Delay(1100);              // the stamp has whole-second resolution in ISO-8601
        await SignInAsync("hermione");
        var second = Assert.Single(await store.ListDirectoryAsync());

        Assert.Equal(UserRole.Viewer, second.LastRole);
        Assert.NotEqual(first.LastLoginAt, second.LastLoginAt);
        // "coming in since" is the one thing a fresh sign-in cannot tell you, so it is kept
        Assert.Equal(first.FirstSeenAt, second.FirstSeenAt);
    }

    [Fact]
    public async Task ARefusedSignIn_LeavesNoRow()
    {
        _directory.Role = null;   // bound, but in none of the configured groups

        var response = await _client.PostAsJsonAsync("/api/auth/login",
            new { username = "draco", password = "whatever", method = "ldap" });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);

        Assert.Empty(await _factory.Services.GetRequiredService<IUserStore>().ListDirectoryAsync());
    }

    private sealed class StubDirectory : ILdapAuthenticator
    {
        public string? Role { get; set; } = UserRole.Admin;

        public Task<LdapAuthResult> AuthenticateAsync(
            LdapSettings settings, string username, string password,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(Role is null
                ? LdapAuthResult.NoRole(["cn=other,ou=groups,dc=test,dc=local"])
                : LdapAuthResult.Success(Role, ["cn=logharbor-admin,ou=groups,dc=test,dc=local"]));
    }
}
