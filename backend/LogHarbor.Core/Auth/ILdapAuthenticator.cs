namespace LogHarbor.Core.Auth;

/// <summary>
/// The outcome of one directory sign-in attempt.
/// </summary>
/// <remarks>
/// Carries the reason it failed as well as the fact that it did, because the two go to
/// different places: the login endpoint answers 401 with nothing attached whatever happened,
/// and the reason goes to the server log and to the Settings test button. "No such user" and
/// "in none of the LogHarbor groups" are both answers an attacker would like.
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

    /// <summary>The credentials were accepted by the directory.</summary>
    public bool Bound { get; }

    /// <summary>The role the groups earn, null when they earn none.</summary>
    public string? Role { get; }

    /// <summary>Every group the directory reported, whether or not it mapped to a role.</summary>
    public IReadOnlyList<string> Groups { get; }

    /// <summary>Why this attempt did not produce a session. Never sent to an unauthenticated caller.</summary>
    public string? Failure { get; }

    public bool Succeeded => Bound && Role is not null;

    public static LdapAuthResult Success(string role, IReadOnlyList<string> groups) =>
        new(bound: true, role, groups, failure: null);

    /// <summary>Bound, but the directory put them in none of the configured groups.</summary>
    public static LdapAuthResult NoRole(IReadOnlyList<string> groups) =>
        new(bound: true, role: null, groups,
            failure: groups.Count == 0
                ? "the directory reported no group memberships"
                : $"in none of the configured groups (member of: {string.Join(", ", groups)})");

    public static LdapAuthResult Failed(string failure) => new(bound: false, null, [], failure);
}

public interface ILdapAuthenticator
{
    /// <summary>
    /// Binds as the user and reads their groups back. Never throws for a bad password or an
    /// unreachable directory — those come back as a failed result with the reason attached.
    /// </summary>
    Task<LdapAuthResult> AuthenticateAsync(
        LdapSettings settings, string username, string password, CancellationToken cancellationToken = default);
}
