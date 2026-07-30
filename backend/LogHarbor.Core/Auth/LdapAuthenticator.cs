using System.DirectoryServices.Protocols;
using System.Net;
using System.Text;

namespace LogHarbor.Core.Auth;

/// <summary>
/// Signs in against a directory by binding as the user themselves.
/// </summary>
/// <remarks>
/// No service account and no stored password: the user's own credentials both authenticate
/// them and authorise reading their own entry, so nothing secret has to live in the database.
/// The role is re-read on every login rather than mirrored into the users table, because a
/// copy goes stale the moment somebody is moved out of a group.
/// </remarks>
public sealed class LdapAuthenticator : ILdapAuthenticator
{
    /// <summary>A directory that stops answering must not take the login page down with it.</summary>
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

    /// <summary>AD's "walk the group tree" matching rule. No other directory implements it.</summary>
    private const string NestedGroupRule = "1.2.840.113556.1.4.1941";

    /// <summary>
    /// Makes <see cref="LdapSettings.AllowInvalidCertificate"/> work on Linux. Must be called
    /// before the first LDAP connection of the process.
    /// </summary>
    /// <remarks>
    /// Measured, not assumed: on Linux, System.DirectoryServices.Protocols binds the system
    /// libldap, which does its own TLS verification and ignores the managed
    /// VerifyServerCertificate callback completely. Every StartTLS and LDAPS bind came back as
    /// "LDAP error 81: The LDAP server is unavailable" against a self-signed directory, while
    /// plain ldap:// to the same host worked — and none of it reproduced on Windows, which uses
    /// wldap32 and does honour the callback. libldap reads TLS_REQCERT from this environment
    /// variable, and only once, the first time it initialises; setting it later has no effect,
    /// which is why this runs at startup rather than per connection.
    /// </remarks>
    public static void AllowUntrustedCertificates()
    {
        Environment.SetEnvironmentVariable("LDAPTLS_REQCERT", "never");
        if (OperatingSystem.IsWindows())
        {
            return;
        }
        // and again through libc, because the managed call is not enough: on Unix
        // Environment.SetEnvironmentVariable updates .NET's own copy of the environment and
        // never calls setenv, so getenv inside libldap still sees nothing. Measured — the
        // managed call alone left every TLS bind failing exactly as before.
        try
        {
            SetEnv("LDAPTLS_REQCERT", "never", 1);
        }
        catch (Exception exception) when (exception is DllNotFoundException or EntryPointNotFoundException)
        {
            // a platform without libc: TLS then verifies as usual, which is the safe direction
        }
    }

    [System.Runtime.InteropServices.DllImport("libc", EntryPoint = "setenv",
        CharSet = System.Runtime.InteropServices.CharSet.Ansi)]
    private static extern int SetEnv(string name, string value, int overwrite);

    public Task<LdapAuthResult> AuthenticateAsync(
        LdapSettings settings, string username, string password,
        CancellationToken cancellationToken = default)
        // System.DirectoryServices.Protocols is synchronous; keep it off the request thread
        => Task.Run(() => Authenticate(settings, username, password), cancellationToken);

    private static LdapAuthResult Authenticate(LdapSettings settings, string username, string password)
    {
        if (!settings.Enabled)
        {
            return LdapAuthResult.Failed("LDAP sign-in is not enabled");
        }
        // an empty password with AuthType.Basic is an anonymous bind on many directories, which
        // succeeds and would hand out a session to anyone who knows a username
        if (username.Length == 0 || password.Length == 0)
        {
            return LdapAuthResult.Failed("username and password are both required");
        }
        var bindName = settings.BindNameFor(username);
        if (bindName is null)
        {
            return LdapAuthResult.Failed(
                "neither a UPN suffix nor a user DN pattern is configured, so there is nothing to bind as");
        }

        try
        {
            using var connection = Connect(settings);
            connection.Bind(new NetworkCredential(bindName, password));

            var userDn = settings.UsesDnBind ? bindName : FindUserDn(connection, settings, username);
            if (userDn is null)
            {
                return LdapAuthResult.Failed(
                    $"bound as {bindName} but no entry for it was found under {settings.BaseDn}");
            }

            var groups = ReadGroups(connection, settings, userDn);
            var role = settings.RoleFor(groups);
            return role is null ? LdapAuthResult.NoRole(groups) : LdapAuthResult.Success(role, groups);
        }
        catch (LdapException exception)
        {
            // 49 is invalidCredentials — by far the most common, and the only one that is not a
            // configuration problem, so it is worth naming in the log
            var reason = exception.ErrorCode == 49
                ? "the directory rejected the credentials"
                : $"LDAP error {exception.ErrorCode}: {exception.Message}";
            return LdapAuthResult.Failed(reason);
        }
        catch (Exception exception) when (exception is DirectoryOperationException or InvalidOperationException
                                              or System.Runtime.InteropServices.COMException)
        {
            return LdapAuthResult.Failed($"{exception.GetType().Name}: {exception.Message}");
        }
    }

    private static LdapConnection Connect(LdapSettings settings)
    {
        var identifier = new LdapDirectoryIdentifier(settings.Host, settings.Port);
        var connection = new LdapConnection(identifier)
        {
            AuthType = AuthType.Basic,
            Timeout = Timeout,
        };
        connection.SessionOptions.ProtocolVersion = 3;
        // the referral chase is another server's problem and another network round trip; a
        // referral mid-login is a hang waiting to happen
        connection.SessionOptions.ReferralChasing = ReferralChasingOptions.None;

        // Windows only, and the guard is not a formality: on Linux this callback is not merely
        // ignored, it breaks the connection. With it set, even a plain ldap:// bind that worked a
        // moment earlier came back as "error 81, server unavailable" — a setting named after
        // certificates taking down a connection that has no TLS in it at all. Linux gets the same
        // behaviour from libldap's TLS_REQCERT (AllowUntrustedCertificates).
        if (settings.AllowInvalidCertificate && OperatingSystem.IsWindows())
        {
            connection.SessionOptions.VerifyServerCertificate = (_, _) => true;
        }
        if (settings.Security == LdapSecurity.Ldaps)
        {
            connection.SessionOptions.SecureSocketLayer = true;
        }

        connection.Bind(new NetworkCredential());  // anonymous, so StartTLS can negotiate first
        if (settings.Security == LdapSecurity.StartTls)
        {
            connection.SessionOptions.StartTransportLayerSecurity(null);
        }
        return connection;
    }

    /// <summary>
    /// Where the account lives, for a UPN bind that never said.
    /// </summary>
    /// <remarks>
    /// Binding as user@domain works without knowing the DN, but the groups are on the entry, so
    /// it still has to be found. Both spellings are tried because an AD account can be signed in
    /// to by either.
    /// </remarks>
    private static string? FindUserDn(LdapConnection connection, LdapSettings settings, string username)
    {
        var escaped = EscapeFilter(username);
        var upn = EscapeFilter($"{username}@{settings.UpnSuffix.TrimStart('@')}");
        var request = new SearchRequest(
            settings.BaseDn,
            $"(|(userPrincipalName={upn})(sAMAccountName={escaped})(uid={escaped}))",
            SearchScope.Subtree,
            "distinguishedName");

        var response = (SearchResponse)connection.SendRequest(request);
        return response.Entries.Count > 0 ? response.Entries[0].DistinguishedName : null;
    }

    private static IReadOnlyList<string> ReadGroups(
        LdapConnection connection, LdapSettings settings, string userDn)
    {
        var groups = new List<string>();

        var request = new SearchRequest(userDn, "(objectClass=*)", SearchScope.Base, "memberOf");
        var response = (SearchResponse)connection.SendRequest(request);
        if (response.Entries.Count > 0)
        {
            groups.AddRange(Values(response.Entries[0].Attributes["memberOf"]));
        }

        if (settings.NestedGroups)
        {
            groups.AddRange(ReadNestedGroups(connection, settings, userDn));
        }
        return groups;
    }

    /// <summary>
    /// Groups reached through other groups.
    /// </summary>
    /// <remarks>
    /// memberOf lists only direct membership, so "member of a team that is a member of
    /// logharbor-admin" is invisible to it. This asks the directory to walk the chain instead,
    /// which only Active Directory can do — anywhere else the search simply returns nothing, and
    /// a failure here must not lose a login that direct memberOf already earned.
    /// </remarks>
    private static IReadOnlyList<string> ReadNestedGroups(
        LdapConnection connection, LdapSettings settings, string userDn)
    {
        try
        {
            var request = new SearchRequest(
                settings.BaseDn,
                $"(member:{NestedGroupRule}:={EscapeFilter(userDn)})",
                SearchScope.Subtree,
                "distinguishedName");
            var response = (SearchResponse)connection.SendRequest(request);
            return response.Entries.Cast<SearchResultEntry>().Select(entry => entry.DistinguishedName).ToList();
        }
        catch (Exception exception) when (exception is LdapException or DirectoryOperationException)
        {
            return [];
        }
    }

    private static IEnumerable<string> Values(DirectoryAttribute? attribute)
    {
        if (attribute is null)
        {
            yield break;
        }
        foreach (var value in attribute.GetValues(typeof(string)))
        {
            if (value is string text)
            {
                yield return text;
            }
        }
    }

    /// <summary>
    /// RFC 4515 escaping for a value going into a search filter.
    /// </summary>
    /// <remarks>
    /// The username is attacker-supplied. Unescaped, a `*` matches every account and `)(` closes
    /// the filter and opens another — the classic way to turn a lookup into "any user at all".
    /// </remarks>
    private static string EscapeFilter(string value)
    {
        var escaped = new StringBuilder(value.Length);
        foreach (var c in value)
        {
            switch (c)
            {
                case '\\': escaped.Append("\\5c"); break;
                case '*': escaped.Append("\\2a"); break;
                case '(': escaped.Append("\\28"); break;
                case ')': escaped.Append("\\29"); break;
                case '\0': escaped.Append("\\00"); break;
                case '/': escaped.Append("\\2f"); break;
                default: escaped.Append(c); break;
            }
        }
        return escaped.ToString();
    }
}
