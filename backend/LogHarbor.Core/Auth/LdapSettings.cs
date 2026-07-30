using System.Text;
using LogHarbor.Core.Storage;

namespace LogHarbor.Core.Auth;

/// <summary>How the connection to the directory is protected.</summary>
public static class LdapSecurity
{
    /// <summary>Implicit TLS, normally port 636.</summary>
    public const string Ldaps = "ldaps";

    /// <summary>Plain connection upgraded with StartTLS, normally port 389.</summary>
    public const string StartTls = "starttls";

    /// <summary>No encryption: a domain password crosses the network in the clear. Never the
    /// default, and the Settings card warns when it is picked.</summary>
    public const string None = "none";

    public static bool IsValid(string value) => value is Ldaps or StartTls or None;
}

/// <summary>
/// Directory sign-in configuration, stored as JSON under the "ldap" settings key. Holds no
/// password: binding as the signing-in user both authenticates them and reads their own
/// groups, so nothing secret needs to live in the database.
/// </summary>
public sealed record LdapSettings
{
    public bool Enabled { get; init; }

    public string Host { get; init; } = "";

    public int Port { get; init; } = 636;

    public string Security { get; init; } = LdapSecurity.Ldaps;

    public string BaseDn { get; init; } = "";

    /// <summary>Active Directory binds as user@suffix, needing no knowledge of where in the
    /// tree the account lives.</summary>
    public string UpnSuffix { get; init; } = "";

    /// <summary>Bind DN template with {0} for the username. UPN bind is an Active Directory
    /// extension, so everything else needs this. Wins over UpnSuffix when both are set.</summary>
    public string UserDnPattern { get; init; } = "";

    public string AdminGroup { get; init; } = "logharbor-admin";

    public string ViewerGroup { get; init; } = "logharbor-viewer";

    /// <summary>Follow group-in-group membership. AD-only: it needs the
    /// member:1.2.840.113556.1.4.1941: matching rule, which no other directory implements.</summary>
    public bool NestedGroups { get; init; }

    /// <summary>Accept a certificate that does not validate. Off by default: it leaves the
    /// connection encrypted but unable to tell the directory from anything standing in front
    /// of it. Exists so a self-signed test directory can exercise the TLS paths.</summary>
    public bool AllowInvalidCertificate { get; init; }

    public bool UsesDnBind => UserDnPattern.Length > 0;

    /// <summary>What to bind as, or null when neither bind form is configured.</summary>
    public string? BindNameFor(string username)
    {
        if (username.Length == 0)
        {
            return null;
        }
        if (UsesDnBind)
        {
            return UserDnPattern.Replace("{0}", EscapeDnValue(username), StringComparison.Ordinal);
        }
        return UpnSuffix.Length > 0 ? $"{username}@{UpnSuffix.TrimStart('@')}" : null;
    }

    /// <summary>
    /// The role these group memberships earn, or null when they earn none.
    /// </summary>
    /// <remarks>
    /// Admin outranks viewer: someone in both groups is an admin, because the alternative —
    /// whichever the directory happened to list first — is a role that changes without anyone
    /// changing anything.
    /// </remarks>
    public string? RoleFor(IEnumerable<string> memberOf)
    {
        var viewer = false;
        foreach (var group in memberOf)
        {
            if (Matches(group, AdminGroup))
            {
                return UserRole.Admin;
            }
            viewer |= Matches(group, ViewerGroup);
        }
        return viewer ? UserRole.Viewer : null;
    }

    /// <summary>memberOf arrives as a whole DN, so a plain string compare against the
    /// configured group name would match nothing and leave every user without a role. A group
    /// configured as a full DN is accepted too.</summary>
    private static bool Matches(string memberOfValue, string configured)
    {
        if (configured.Length == 0)
        {
            return false;
        }
        if (string.Equals(memberOfValue, configured, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        return string.Equals(FirstRdnValue(memberOfValue), configured.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>"cn=logharbor-admin,ou=groups,dc=..." -> "logharbor-admin".</summary>
    private static string FirstRdnValue(string dn)
    {
        var end = 0;
        while (end < dn.Length)
        {
            if (dn[end] == '\\')
            {
                end += 2;
                continue;
            }
            if (dn[end] == ',')
            {
                break;
            }
            end++;
        }
        var rdn = dn[..Math.Min(end, dn.Length)];
        var equals = rdn.IndexOf('=');
        return equals < 0 ? rdn.Trim() : rdn[(equals + 1)..].Trim();
    }

    /// <summary>RFC 4514 escaping. The username lands inside a DN template; unescaped, a comma
    /// turns one RDN into two and the bind targets a DN the operator never configured.</summary>
    private static string EscapeDnValue(string value)
    {
        var escaped = new StringBuilder(value.Length);
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            var leadingOrTrailingSpace = c == ' ' && (i == 0 || i == value.Length - 1);
            if (c is '\\' or ',' or '+' or '"' or '<' or '>' or ';' or '=' || leadingOrTrailingSpace
                || (c == '#' && i == 0))
            {
                escaped.Append('\\');
            }
            if (c < ' ')
            {
                escaped.Append('\\').Append(((int)c).ToString("X2"));
                continue;
            }
            escaped.Append(c);
        }
        return escaped.ToString();
    }
}
