using LogHarbor.Core.Auth;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Auth;

public sealed class LdapSettingsTests
{
    private static readonly LdapSettings Settings = new()
    {
        AdminGroup = "logharbor-admin",
        ViewerGroup = "logharbor-viewer",
    };

    // memberOf is a whole DN, never a bare name. Comparing it to the configured group as a
    // plain string matches nothing, and every user then maps to no role at all.
    [Fact]
    public void GroupDn_MapsToItsRole()
    {
        Assert.Equal(UserRole.Admin, Settings.RoleFor(["cn=logharbor-admin,ou=groups,dc=test,dc=local"]));
        Assert.Equal(UserRole.Viewer, Settings.RoleFor(["cn=logharbor-viewer,ou=groups,dc=test,dc=local"]));
    }

    // Active Directory answers with its own capitalisation and its own spacing
    [Fact]
    public void GroupDn_MatchesRegardlessOfCase()
    {
        Assert.Equal(UserRole.Admin, Settings.RoleFor(["CN=LogHarbor-Admin,OU=Groups,DC=corp,DC=example"]));
    }

    [Fact]
    public void AdminOutranksViewer()
    {
        string[] both =
        [
            "cn=logharbor-viewer,ou=groups,dc=test,dc=local",
            "cn=logharbor-admin,ou=groups,dc=test,dc=local",
        ];
        Assert.Equal(UserRole.Admin, Settings.RoleFor(both));
        Assert.Equal(UserRole.Admin, Settings.RoleFor(both.Reverse()));
    }

    // the case nobody remembers to create in the directory, and the one that has to be refused
    [Fact]
    public void MemberOfNeitherGroup_EarnsNoRole()
    {
        Assert.Null(Settings.RoleFor(["cn=domain users,cn=users,dc=corp,dc=example"]));
        Assert.Null(Settings.RoleFor([]));
    }

    // a group whose name merely contains the configured one is a different group
    [Fact]
    public void SimilarlyNamedGroup_DoesNotMatch()
    {
        Assert.Null(Settings.RoleFor(["cn=logharbor-admins,ou=groups,dc=test,dc=local"]));
        Assert.Null(Settings.RoleFor(["cn=old-logharbor-admin,ou=groups,dc=test,dc=local"]));
    }

    [Fact]
    public void GroupConfiguredAsAFullDn_AlsoMatches()
    {
        var settings = Settings with { AdminGroup = "cn=logharbor-admin,ou=groups,dc=test,dc=local" };
        Assert.Equal(UserRole.Admin, settings.RoleFor(["cn=logharbor-admin,ou=groups,dc=test,dc=local"]));
    }

    [Fact]
    public void UpnBind_IsUsernameAtSuffix()
    {
        var settings = Settings with { UpnSuffix = "corp.example" };
        Assert.Equal("jdoe@corp.example", settings.BindNameFor("jdoe"));
    }

    [Fact]
    public void UpnSuffixWithLeadingAt_DoesNotDoubleIt()
    {
        var settings = Settings with { UpnSuffix = "@corp.example" };
        Assert.Equal("jdoe@corp.example", settings.BindNameFor("jdoe"));
    }

    // OpenLDAP has no UPN bind, so without this the feature could only ever be pointed at a
    // real domain controller — including while it was being written
    [Fact]
    public void DnPatternBind_SubstitutesTheUsername()
    {
        var settings = Settings with { UserDnPattern = "uid={0},ou=users,dc=test,dc=local" };
        Assert.Equal("uid=testuser1,ou=users,dc=test,dc=local", settings.BindNameFor("testuser1"));
    }

    [Fact]
    public void DnPattern_WinsOverUpnSuffix()
    {
        var settings = Settings with
        {
            UserDnPattern = "uid={0},ou=users,dc=test,dc=local",
            UpnSuffix = "corp.example",
        };
        Assert.Equal("uid=testuser1,ou=users,dc=test,dc=local", settings.BindNameFor("testuser1"));
    }

    // The username is attacker-supplied and lands in the middle of a DN. Unescaped, the comma
    // ends the RDN and the bind is attempted against a DN the operator never configured — here,
    // one under ou=admins. Escaping keeps the whole thing one value.
    [Fact]
    public void UsernameWithDnSyntax_IsEscaped()
    {
        var settings = Settings with { UserDnPattern = "uid={0},ou=users,dc=test,dc=local" };
        Assert.Equal(
            "uid=evil\\,ou\\=admins,ou=users,dc=test,dc=local",
            settings.BindNameFor("evil,ou=admins"));
    }

    [Fact]
    public void NeitherBindFormConfigured_IsNull()
    {
        Assert.Null(Settings.BindNameFor("jdoe"));
    }

    [Fact]
    public void EmptyUsername_IsNull()
    {
        var settings = Settings with { UpnSuffix = "corp.example" };
        Assert.Null(settings.BindNameFor(""));
    }
}
