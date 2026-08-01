namespace LogHarbor.Core.Storage;

public static class UserRole
{
    public const string Admin = "admin";
    public const string Viewer = "viewer";

    public static bool IsValid(string role) => role is Admin or Viewer;
}

/// <summary>An account that can sign in to the UI/management API. Passwords are PBKDF2-hashed.</summary>
public sealed record User(
    long Id, string Username, string Role, string CreatedAt, bool MustChangePassword,
    string? LastLoginAt = null);

/// <summary>
/// A directory principal that has signed in at least once. A record, not an account.
/// </summary>
/// <remarks>
/// It grants nothing: the directory is asked again at every sign-in, and this row is not
/// consulted on the way in. <see cref="LastRole"/> is what the directory answered the last time,
/// kept so the list can say what someone came in as — not so LogHarbor can decide it.
/// </remarks>
public sealed record DirectoryUser(string Username, string LastRole, string FirstSeenAt, string LastLoginAt);

public interface IUserStore
{
    /// <summary>Throws <see cref="DuplicateUsernameException"/> when the username is taken (case-insensitive).</summary>
    Task<User> CreateAsync(
        string username,
        string password,
        string role,
        bool mustChangePassword = false,
        CancellationToken cancellationToken = default);

    /// <summary>Replaces the password and clears MustChangePassword. False when the user is gone.</summary>
    Task<bool> SetPasswordAsync(long id, string password, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<User>> ListAsync(CancellationToken cancellationToken = default);

    Task<User?> FindAsync(long id, CancellationToken cancellationToken = default);

    Task<bool> DeleteAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>The user when the credentials match, otherwise null. Constant-time verification.</summary>
    Task<User?> AuthenticateAsync(string username, string password, CancellationToken cancellationToken = default);

    Task<long> CountAsync(CancellationToken cancellationToken = default);

    Task<long> CountAdminsAsync(CancellationToken cancellationToken = default);

    /// <summary>Stamps a local account's last sign-in. Silently does nothing when it is gone.</summary>
    Task RecordLoginAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>First sign-in inserts, every later one updates the role and the timestamp.</summary>
    Task RecordDirectoryLoginAsync(string username, string role, CancellationToken cancellationToken = default);

    /// <summary>Directory principals that have signed in at least once, newest sign-in first.</summary>
    Task<IReadOnlyList<DirectoryUser>> ListDirectoryAsync(CancellationToken cancellationToken = default);
}

public sealed class DuplicateUsernameException : Exception
{
    public DuplicateUsernameException(string username)
        : base($"A user named '{username}' already exists.")
    {
    }
}
