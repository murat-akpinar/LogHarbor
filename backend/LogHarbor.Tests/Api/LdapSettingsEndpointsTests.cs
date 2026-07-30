using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace LogHarbor.Tests.Api;

public sealed class LdapSettingsEndpointsTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public LdapSettingsEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

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
        var settings = await _client.GetFromJsonAsync<JsonElement>("/api/settings/ldap");
        Assert.False(settings.GetProperty("enabled").GetBoolean());
        // the defaults the card starts from, so an operator does not have to know the names
        Assert.Equal("logharbor-admin", settings.GetProperty("adminGroup").GetString());
        Assert.Equal("logharbor-viewer", settings.GetProperty("viewerGroup").GetString());
    }

    [Fact]
    public async Task Saved_ReadsBack()
    {
        var put = await _client.PutAsJsonAsync("/api/settings/ldap", Valid());
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var settings = await _client.GetFromJsonAsync<JsonElement>("/api/settings/ldap");
        Assert.True(settings.GetProperty("enabled").GetBoolean());
        Assert.Equal("192.168.1.132", settings.GetProperty("host").GetString());
        Assert.Equal("uid={0},ou=users,dc=test,dc=local", settings.GetProperty("userDnPattern").GetString());
    }

    /// <summary>Nothing about the directory is a secret worth hiding, but nothing about it is
    /// stored either — the response must never grow a password field.</summary>
    [Fact]
    public async Task Response_CarriesNoSecret()
    {
        await _client.PutAsJsonAsync("/api/settings/ldap", Valid());
        var body = await _client.GetStringAsync("/api/settings/ldap");
        Assert.DoesNotContain("password", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("secret", body, StringComparison.OrdinalIgnoreCase);
    }

    // a half-filled card saved with the feature off is someone still typing; refusing it
    // throws their work away for no gain
    [Fact]
    public async Task Disabled_SavesWithoutTheRequiredFields()
    {
        var response = await _client.PutAsJsonAsync("/api/settings/ldap",
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
        var response = await _client.PutAsJsonAsync("/api/settings/ldap", body);
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
        var response = await _client.PutAsJsonAsync("/api/settings/ldap", body);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpnSuffixAlone_IsEnough()
    {
        var body = Valid();
        body["userDnPattern"] = "";
        body["upnSuffix"] = "corp.example";
        var response = await _client.PutAsJsonAsync("/api/settings/ldap", body);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task DnPatternWithoutThePlaceholder_IsRejected()
    {
        var body = Valid();
        body["userDnPattern"] = "uid=admin,ou=users,dc=test,dc=local";
        var response = await _client.PutAsJsonAsync("/api/settings/ldap", body);
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
        var response = await _client.PutAsJsonAsync("/api/settings/ldap", body);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UnknownSecurity_IsRejected()
    {
        var body = Valid();
        body["security"] = "tls-ish";
        var response = await _client.PutAsJsonAsync("/api/settings/ldap", body);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(70000)]
    public async Task PortOutOfRange_IsRejected(int port)
    {
        var body = Valid();
        body["port"] = port;
        var response = await _client.PutAsJsonAsync("/api/settings/ldap", body);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
