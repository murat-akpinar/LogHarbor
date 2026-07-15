namespace LogHarbor.Core.Storage;

public static class UserRole
{
    public const string Admin = "admin";
    public const string Viewer = "viewer";

    public static bool IsValid(string role) => role is Admin or Viewer;
}

/// <summary>An account that can sign in to the UI/management API. Passwords are PBKDF2-hashed.</summary>
public sealed record User(long Id, string Username, string Role, string CreatedAt, bool MustChangePassword);

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
}

public sealed class DuplicateUsernameException : Exception
{
    public DuplicateUsernameException(string username)
        : base($"A user named '{username}' already exists.")
    {
    }
}
