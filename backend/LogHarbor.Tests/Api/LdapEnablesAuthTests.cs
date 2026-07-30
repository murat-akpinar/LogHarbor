using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using LogHarbor.Core.Auth;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Api;

/// <summary>
/// An LDAP-only install has no local accounts, and "is auth on?" used to be "does any user
/// exist?". So a server whose only sign-in method was the directory answered authRequired=false,
/// the SPA never rendered a login page, and everything behind the gate was open to anyone who
/// could reach the port — with LDAP configured and apparently protecting it.
/// </summary>
public sealed class LdapEnablesAuthTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();

    private HttpClient NewClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

    public void Dispose() => _factory.Dispose();

    private static LdapSettings Enabled() => new()
    {
        Enabled = true,
        Host = "192.168.1.132",
        Port = 389,
        Security = LdapSecurity.StartTls,
        BaseDn = "dc=test,dc=local",
        UserDnPattern = "uid={0},ou=users,dc=test,dc=local",
    };

    [Fact]
    public async Task WithNoLocalUsers_EnablingLdap_TurnsAuthenticationOn()
    {
        var client = NewClient();

        // no accounts, no LDAP: the open install everything else in the suite relies on
        var before = await client.GetFromJsonAsync<JsonElement>("/api/auth/status");
        Assert.False(before.GetProperty("authRequired").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/signals")).StatusCode);

        await _factory.Services.GetRequiredService<ISettingsStore>().SaveLdapSettingsAsync(Enabled());
        _factory.Services.GetRequiredService<LogHarbor.Api.Auth.AuthService>().Invalidate();

        var after = await client.GetFromJsonAsync<JsonElement>("/api/auth/status");
        Assert.True(after.GetProperty("authRequired").GetBoolean());
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/signals")).StatusCode);
    }

    /// <summary>Saving through the endpoint has to take effect immediately; the gate caches the
    /// answer, so a save that does not invalidate it leaves the server open until it restarts.</summary>
    [Fact]
    public async Task SavingThroughTheEndpoint_TakesEffectWithoutARestart()
    {
        var client = NewClient();
        var put = await client.PutAsJsonAsync("/api/settings/ldap", new
        {
            enabled = true,
            host = "192.168.1.132",
            port = 389,
            security = "starttls",
            baseDn = "dc=test,dc=local",
            userDnPattern = "uid={0},ou=users,dc=test,dc=local",
            adminGroup = "logharbor-admin",
            viewerGroup = "logharbor-viewer",
        });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        // the very next request on the same client, with no restart in between
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/signals")).StatusCode);
    }
}
