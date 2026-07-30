using System.DirectoryServices.Protocols;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;

namespace LogHarbor.Core.Auth;

/// <summary>
/// Signs in against a directory by binding as the user themselves, so there is no service
/// account and no stored password. The role is re-read on every login rather than mirrored
/// locally, because a copy goes stale the moment somebody is moved out of a group.
/// </summary>
public sealed class LdapAuthenticator : ILdapAuthenticator
{
    /// <summary>A directory that stops answering must not take the login page down with it.</summary>
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

    /// <summary>Longer than any real account name; the value is unvalidated network input that
    /// ends up in a DN, a search filter and a log line.</summary>
    private const int MaxUsernameLength = 256;

    /// <summary>AD's "walk the group tree" matching rule. No other directory implements it.</summary>
    private const string NestedGroupRule = "1.2.840.113556.1.4.1941";

    private const int InvalidCredentials = 49;

    /// <summary>
    /// Makes <see cref="LdapSettings.AllowInvalidCertificate"/> work on Linux, where verification
    /// belongs to libldap rather than to .NET. Must run before the process opens its first LDAP
    /// connection: libldap reads this once, when it initialises.
    /// </summary>
    private static bool _untrustedCertificatesAllowed;

    public static void AllowUntrustedCertificates()
    {
        _untrustedCertificatesAllowed = true;
        Environment.SetEnvironmentVariable("LDAPTLS_REQCERT", "never");
        if (OperatingSystem.IsWindows())
        {
            return;
        }
        // and again through libc: on Unix the managed call updates .NET's own copy of the
        // environment and never calls setenv, so getenv inside libldap still sees nothing
        try
        {
            SetEnv("LDAPTLS_REQCERT", "never", 1);
        }
        catch (Exception exception) when (exception is DllNotFoundException or EntryPointNotFoundException)
        {
            // no libc: TLS keeps verifying, which is the safe direction to fail in
        }
    }

    [DllImport("libc", EntryPoint = "setenv", CharSet = CharSet.Ansi)]
    private static extern int SetEnv(string name, string value, int overwrite);

    public Task<LdapAuthResult> AuthenticateAsync(
        LdapSettings settings, string username, string password,
        CancellationToken cancellationToken = default)
        // the library is synchronous; keep the blocking calls off the request thread
        => Task.Run(() => Authenticate(settings, username, password), cancellationToken);

    private static LdapAuthResult Authenticate(LdapSettings settings, string username, string password)
    {
        if (!settings.Enabled)
        {
            return LdapAuthResult.Failed("LDAP sign-in is not enabled");
        }
        if (!IsPlausibleUsername(username) || password.Length == 0)
        {
            // an empty password with AuthType.Basic is an anonymous bind on many directories,
            // which succeeds and would hand a session to anyone who knows a username
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
                return LdapAuthResult.Failed($"no entry found under {settings.BaseDn} for this account");
            }

            var groups = ReadGroups(connection, settings, userDn);
            var role = settings.RoleFor(groups);
            return role is null ? LdapAuthResult.NoRole(groups) : LdapAuthResult.Success(role, groups);
        }
        catch (LdapException exception)
        {
            if (exception.ErrorCode == InvalidCredentials)
            {
                return LdapAuthResult.Failed("the directory rejected the credentials");
            }
            return LdapAuthResult.Failed(
                $"LDAP error {exception.ErrorCode}: {exception.Message}{PendingRestartHint(settings)}");
        }
        catch (Exception exception) when (exception is DirectoryOperationException
                                              or InvalidOperationException or COMException)
        {
            return LdapAuthResult.Failed($"{exception.GetType().Name}: {exception.Message}");
        }
    }

    /// <summary>
    /// Rejects what no directory would accept anyway.
    /// </summary>
    /// <remarks>
    /// The local user table validates its usernames; this path bypassed that entirely, so the
    /// value arrived straight off the wire at unbounded length. A newline in it would forge a
    /// second line in the server log, where the refusal reason is written.
    /// </remarks>
    private static bool IsPlausibleUsername(string username)
        => username.Length is > 0 and <= MaxUsernameLength && !username.Any(char.IsControl);

    /// <summary>
    /// Names the likeliest cause of a connection error nobody would otherwise guess.
    /// </summary>
    /// <remarks>
    /// Turning on "accept an untrusted certificate" and pressing Test straight away reports
    /// "the connection cannot be established" — a network problem, as far as the message goes,
    /// on a directory that is answering perfectly well. The setting only reaches libldap at
    /// startup, and this is the moment somebody finds that out.
    /// </remarks>
    private static string PendingRestartHint(LdapSettings settings)
        => settings.AllowInvalidCertificate && !_untrustedCertificatesAllowed
           && settings.Security != LdapSecurity.None && !OperatingSystem.IsWindows()
            ? " — this server has not been restarted since \"accept an untrusted certificate\" "
              + "was turned on, and on Linux that setting only takes effect at startup"
            : "";

    private static LdapConnection Connect(LdapSettings settings)
    {
        var connection = new LdapConnection(new LdapDirectoryIdentifier(settings.Host, settings.Port))
        {
            AuthType = AuthType.Basic,
            Timeout = Timeout,
        };
        connection.SessionOptions.ProtocolVersion = 3;
        // chasing a referral is another server's problem and another round trip mid-login
        connection.SessionOptions.ReferralChasing = ReferralChasingOptions.None;

        // Windows only, and not a formality: on Linux setting this callback breaks the
        // connection outright — even a plain ldap:// bind then fails as "server unavailable".
        // Linux gets the same behaviour from AllowUntrustedCertificates.
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

    /// <summary>Where the account lives, for a UPN bind that never said. Both AD spellings are
    /// tried because an account can be signed in to by either.</summary>
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
    /// Groups reached through other groups, which memberOf does not report.
    /// </summary>
    /// <remarks>
    /// Only Active Directory implements the matching rule. Anywhere else the search returns
    /// nothing or errors, and neither may cost a login that direct memberOf already earned.
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

    /// <summary>RFC 4515 escaping. Unescaped, a `*` in the username matches every account and
    /// `)(` closes the filter and opens another.</summary>
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
