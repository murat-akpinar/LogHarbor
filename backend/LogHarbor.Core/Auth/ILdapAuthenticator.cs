namespace LogHarbor.Core.Auth;

/// <summary>
/// The outcome of one directory sign-in attempt.
/// </summary>
/// <remarks>
/// Failure and Groups go to different places. The login endpoint answers 401 with neither of
/// them: "no such user" and "in none of the LogHarbor groups" are both answers an attacker
/// would like. Failure goes to the server log, and Groups only to the admin-only test button —
/// a real directory puts a person in a dozen groups naming their department and projects, and
/// a failed login must not write that profile into a log file.
/// </remarks>
public sealed record LdapAuthResult
{
    private LdapAuthResult(bool bound, string? role, IReadOnlyList<string> groups, string? failure)
    {
        Bound = bound;
        Role = role;
        Groups = groups;
        Failure = failure;
    }

    public bool Bound { get; }

    public string? Role { get; }

    /// <summary>Every group the directory reported. Personal data — see the remarks above.</summary>
    public IReadOnlyList<string> Groups { get; }

    /// <summary>Why this attempt produced no session. Safe to log; never sent to the caller.</summary>
    public string? Failure { get; }

    public bool Succeeded => Bound && Role is not null;

    public static LdapAuthResult Success(string role, IReadOnlyList<string> groups) =>
        new(bound: true, role, groups, failure: null);

    public static LdapAuthResult NoRole(IReadOnlyList<string> groups) =>
        new(bound: true, role: null, groups,
            failure: $"in none of the configured groups ({groups.Count} membership(s) found)");

    public static LdapAuthResult Failed(string failure) => new(bound: false, null, [], failure);
}

public interface ILdapAuthenticator
{
    /// <summary>
    /// Binds as the user and reads their groups back. A bad password or an unreachable
    /// directory comes back as a failed result rather than an exception.
    /// </summary>
    Task<LdapAuthResult> AuthenticateAsync(
        LdapSettings settings, string username, string password, CancellationToken cancellationToken = default);
}
