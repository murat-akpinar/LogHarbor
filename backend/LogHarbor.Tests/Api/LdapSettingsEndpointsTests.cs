using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace LogHarbor.Tests.Api;

public sealed class LdapSettingsEndpointsTests : IAsyncLifetime
{
    private readonly LogHarborApiFactory _factory = new();
    private HttpClient _admin = null!;

    private HttpClient NewClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

    public async Task InitializeAsync()
    {
        _admin = NewClient();
        var created = await _admin.PostAsJsonAsync("/api/users",
            new { username = "alice", password = "password123", role = "admin" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var login = await _admin.PostAsJsonAsync("/api/auth/login",
            new { username = "alice", password = "password123" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    public Task DisposeAsync()
    {
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private static Dictionary<string, object?> Valid() => new()
    {
        ["enabled"] = true,
        ["host"] = "192.168.1.132",
        ["port"] = 389,
        ["security"] = "starttls",
        ["baseDn"] = "dc=test,dc=local",
        ["userDnPattern"] = "uid={0},ou=users,dc=test,dc=local",
        ["adminGroup"] = "logharbor-admin",
        ["viewerGroup"] = "logharbor-viewer",
        ["nestedGroups"] = false,
    };

    [Fact]
    public async Task Unconfigured_ReadsBackDisabled()
    {
        var settings = await _admin.GetFromJsonAsync<JsonElement>("/api/settings/ldap");
        Assert.False(settings.GetProperty("enabled").GetBoolean());
        // the defaults the card starts from, so an operator does not have to know the names
        Assert.Equal("logharbor-admin", settings.GetProperty("adminGroup").GetString());
        Assert.Equal("logharbor-viewer", settings.GetProperty("viewerGroup").GetString());
    }

    [Fact]
    public async Task Saved_ReadsBack()
    {
        var put = await _admin.PutAsJsonAsync("/api/settings/ldap", Valid());
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var settings = await _admin.GetFromJsonAsync<JsonElement>("/api/settings/ldap");
        Assert.True(settings.GetProperty("enabled").GetBoolean());
        Assert.Equal("192.168.1.132", settings.GetProperty("host").GetString());
        Assert.Equal("uid={0},ou=users,dc=test,dc=local", settings.GetProperty("userDnPattern").GetString());
    }

    /// <summary>Nothing about the directory is stored that could leak — the response must never
    /// grow a password field, however the feature evolves.</summary>
    [Fact]
    public async Task Response_CarriesNoSecret()
    {
        await _admin.PutAsJsonAsync("/api/settings/ldap", Valid());
        var body = await _admin.GetStringAsync("/api/settings/ldap");
        Assert.DoesNotContain("password", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("secret", body, StringComparison.OrdinalIgnoreCase);
    }

    // a half-filled card saved with the feature off is someone still typing; refusing it
    // throws their work away for no gain
    [Fact]
    public async Task Disabled_SavesWithoutTheRequiredFields()
    {
        var response = await _admin.PutAsJsonAsync("/api/settings/ldap",
            new Dictionary<string, object?> { ["enabled"] = false, ["host"] = "" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("host", "")]
    [InlineData("baseDn", "")]
    public async Task Enabled_RequiresTheConnectionFields(string field, string value)
    {
        var body = Valid();
        body[field] = value;
        var response = await _admin.PutAsJsonAsync("/api/settings/ldap", body);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(field, await response.Content.ReadAsStringAsync());
    }

    // with neither there is nothing to bind as, and every sign-in fails identically
    [Fact]
    public async Task Enabled_RequiresAUpnSuffixOrADnPattern()
    {
        var body = Valid();
        body["userDnPattern"] = "";
        body["upnSuffix"] = "";
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _admin.PutAsJsonAsync("/api/settings/ldap", body)).StatusCode);
    }

    [Fact]
    public async Task UpnSuffixAlone_IsEnough()
    {
        var body = Valid();
        body["userDnPattern"] = "";
        body["upnSuffix"] = "corp.example";
        Assert.Equal(HttpStatusCode.OK,
            (await _admin.PutAsJsonAsync("/api/settings/ldap", body)).StatusCode);
    }

    [Fact]
    public async Task DnPatternWithoutThePlaceholder_IsRejected()
    {
        var body = Valid();
        body["userDnPattern"] = "uid=admin,ou=users,dc=test,dc=local";
        var response = await _admin.PutAsJsonAsync("/api/settings/ldap", body);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("{0}", await response.Content.ReadAsStringAsync());
    }

    // both blank means no directory user can ever earn a role, so a correct password still
    // answers 401 — the most confusing way to misconfigure this
    [Fact]
    public async Task Enabled_WithNoGroupsAtAll_IsRejected()
    {
        var body = Valid();
        body["adminGroup"] = "";
        body["viewerGroup"] = "";
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _admin.PutAsJsonAsync("/api/settings/ldap", body)).StatusCode);
    }

    [Fact]
    public async Task UnknownSecurity_IsRejected()
    {
        var body = Valid();
        body["security"] = "tls-ish";
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _admin.PutAsJsonAsync("/api/settings/ldap", body)).StatusCode);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(70000)]
    public async Task PortOutOfRange_IsRejected(int port)
    {
        var body = Valid();
        body["port"] = port;
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _admin.PutAsJsonAsync("/api/settings/ldap", body)).StatusCode);
    }

    /// <summary>It describes somebody else's infrastructure — the directory host, the base DN and
    /// the name of the group that grants admin — which a read-only account has no use for.</summary>
    [Fact]
    public async Task Viewer_CannotReadOrWriteIt()
    {
        Assert.Equal(HttpStatusCode.Created, (await _admin.PostAsJsonAsync("/api/users",
            new { username = "bob", password = "password123", role = "viewer" })).StatusCode);
        var viewer = NewClient();
        await viewer.PostAsJsonAsync("/api/auth/login", new { username = "bob", password = "password123" });

        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.GetAsync("/api/settings/ldap")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await viewer.PutAsJsonAsync("/api/settings/ldap", Valid())).StatusCode);
        // the archive settings stay readable, so this is a deliberate difference and not a
        // blanket lockout that happened to catch LDAP too
        Assert.Equal(HttpStatusCode.OK, (await viewer.GetAsync("/api/settings/archive")).StatusCode);
    }

    /// <summary>Status has to advertise it before anyone has signed in, or the login page cannot
    /// know whether to offer the directory tab.</summary>
    [Fact]
    public async Task Status_ReportsWhetherLdapIsOffered()
    {
        var anonymous = NewClient();
        var before = await anonymous.GetFromJsonAsync<JsonElement>("/api/auth/status");
        Assert.False(before.GetProperty("ldapEnabled").GetBoolean());

        await _admin.PutAsJsonAsync("/api/settings/ldap", Valid());

        var after = await anonymous.GetFromJsonAsync<JsonElement>("/api/auth/status");
        Assert.True(after.GetProperty("ldapEnabled").GetBoolean());
    }
}
