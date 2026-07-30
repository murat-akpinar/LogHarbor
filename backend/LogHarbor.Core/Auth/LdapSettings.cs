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

    /// <summary>No encryption. Puts a domain password on the wire; refused unless the host
    /// sets LogHarbor:AllowInsecureLdap, the same shape as AllowInsecureCookie.</summary>
    public const string None = "none";

    public static bool IsValid(string value) => value is Ldaps or StartTls or None;
}

/// <summary>
/// Directory sign-in configuration, stored as JSON under the "ldap" settings key.
/// </summary>
/// <remarks>
/// Deliberately holds no password. A direct bind as the signing-in user is enough to both
/// authenticate them and read their own groups, so nothing secret needs to live in the
/// database; a directory that refuses the self-read needs a service account, and then its
/// password comes from LOGHARBOR_LDAP_BIND_PASSWORD, never through the API.
/// </remarks>
public sealed record LdapSettings
{
    public bool Enabled { get; init; }

    public string Host { get; init; } = "";

    public int Port { get; init; } = 636;

    public string Security { get; init; } = LdapSecurity.Ldaps;

    public string BaseDn { get; init; } = "";

    /// <summary>Active Directory accepts a bind as user@suffix, which needs no knowledge of
    /// where in the tree the account lives.</summary>
    public string UpnSuffix { get; init; } = "";

    /// <summary>
    /// Bind DN template with {0} for the username, e.g. uid={0},ou=users,dc=test,dc=local.
    /// </summary>
    /// <remarks>
    /// Present because UPN is an Active Directory extension and nothing else implements it —
    /// OpenLDAP binds by DN. Without this the feature could only ever be pointed at a real
    /// domain controller, which means it could not be exercised against the test directory
    /// while being written. Takes precedence over UpnSuffix when both are set.
    /// </remarks>
    public string UserDnPattern { get; init; } = "";

    public string AdminGroup { get; init; } = "logharbor-admin";

    public string ViewerGroup { get; init; } = "logharbor-viewer";

    /// <summary>Follow group-in-group membership. AD-only: it needs the
    /// member:1.2.840.113556.1.4.1941: matching rule, which no other directory implements.</summary>
    public bool NestedGroups { get; init; }

    /// <summary>
    /// Accept a server certificate that does not validate — self-signed, expired, or issued to
    /// another name.
    /// </summary>
    /// <remarks>
    /// An escape hatch, off by default, because it turns the encrypted connection into one that
    /// cannot tell the directory from anything standing in front of it. It exists because
    /// self-signed is what a test directory has, and the alternative — no way to point this at
    /// anything but a properly issued certificate — means the TLS paths never get exercised
    /// before production.
    /// </remarks>
    public bool AllowInvalidCertificate { get; init; }

    public bool UsesDnBind => UserDnPattern.Length > 0;

    /// <summary>
    /// The string to bind with for this username, or null when neither bind form is configured.
    /// </summary>
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

    /// <summary>
    /// Whether a memberOf value names the configured group.
    /// </summary>
    /// <remarks>
    /// memberOf comes back as a whole DN — cn=logharbor-admin,ou=groups,dc=test,dc=local —
    /// so comparing it to the configured "logharbor-admin" as a string never matches and every
    /// user maps to no role. The setting is also accepted as a full DN, because an admin who
    /// copied one out of the directory browser has given an unambiguous answer.
    /// </remarks>
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

    /// <summary>
    /// RFC 4514 escaping for a value going into a DN.
    /// </summary>
    /// <remarks>
    /// The username is attacker-supplied and lands in the middle of a DN template. Unescaped,
    /// a comma turns one RDN into two and the bind is attempted against a DN the operator never
    /// configured.
    /// </remarks>
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
