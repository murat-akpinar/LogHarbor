using LogHarbor.Core.Auth;

namespace LogHarbor.Tests.Auth;

/// <summary>
/// What the authenticator decides before it ever reaches the network. A bind cannot be covered
/// here — that is what test/ldap_test exists for.
/// </summary>
public sealed class LdapAuthenticatorTests
{
    private static readonly LdapSettings Configured = new()
    {
        Enabled = true,
        Host = "192.168.1.132",
        Port = 389,
        Security = LdapSecurity.StartTls,
        BaseDn = "dc=test,dc=local",
        UserDnPattern = "uid={0},ou=users,dc=test,dc=local",
    };

    private static readonly LdapAuthenticator Authenticator = new();

    private static Task<LdapAuthResult> AuthenticateAsync(string username, string password) =>
        Authenticator.AuthenticateAsync(Configured, username, password);

    [Fact]
    public async Task Disabled_RefusesWithoutAskingTheDirectory()
    {
        var result = await Authenticator.AuthenticateAsync(
            Configured with { Enabled = false }, "testuser1", "testpass123");
        Assert.False(result.Bound);
    }

    // AuthType.Basic with an empty password is an anonymous bind on many directories: it
    // succeeds, and a session would go to anyone who knows a username
    [Fact]
    public async Task EmptyPassword_IsRefusedBeforeBinding()
    {
        var result = await AuthenticateAsync("testuser1", "");
        Assert.False(result.Bound);
    }

    // the local user table validates its usernames; this path bypassed that entirely
    [Theory]
    [InlineData("")]
    [InlineData("a\nb")]
    [InlineData("a\rb")]
    [InlineData("a\tb")]
    public async Task UsernameNoDirectoryWouldAccept_IsRefused(string username)
    {
        var result = await AuthenticateAsync(username, "testpass123");
        Assert.False(result.Bound);
    }

    // a newline would forge a second line in the server log, where the refusal is written
    [Fact]
    public async Task OverlongUsername_IsRefused()
    {
        var result = await AuthenticateAsync(new string('a', 257), "testpass123");
        Assert.False(result.Bound);
    }

    [Fact]
    public async Task NoBindFormConfigured_SaysSoRatherThanFailingAtTheDirectory()
    {
        var result = await Authenticator.AuthenticateAsync(
            Configured with { UserDnPattern = "", UpnSuffix = "" }, "testuser1", "testpass123");
        Assert.False(result.Bound);
        Assert.Contains("nothing to bind as", result.Failure);
    }
}

public sealed class LdapAuthResultTests
{
    /// <summary>
    /// The reason is written to the server log. A real directory puts a person in a dozen groups
    /// naming their department and their projects, and a failed sign-in must not spill that
    /// profile — or the directory's structure — into a log file. The groups themselves stay on
    /// the result, which only the admin-only test button reads.
    /// </summary>
    [Fact]
    public void NoRoleFailure_CountsGroupsWithoutNamingThem()
    {
        string[] groups =
        [
            "cn=finance-payroll,ou=groups,dc=corp,dc=example",
            "cn=domain users,cn=users,dc=corp,dc=example",
        ];
        var result = LdapAuthResult.NoRole(groups);

        Assert.DoesNotContain("finance-payroll", result.Failure);
        Assert.DoesNotContain("dc=corp", result.Failure);
        Assert.Contains("2", result.Failure);
        Assert.Equal(groups, result.Groups);
    }

    [Fact]
    public void NoRole_IsBoundButUnsuccessful()
    {
        var result = LdapAuthResult.NoRole([]);
        Assert.True(result.Bound);
        Assert.False(result.Succeeded);
        Assert.Null(result.Role);
    }
}
