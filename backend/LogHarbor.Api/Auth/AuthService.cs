using System.Collections.Concurrent;
using System.Security.Claims;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Auth;

/// <summary>
/// Auth is enabled when at least one local user exists, or when LDAP sign-in is configured.
/// The flag is cached because the gate middleware asks on every request; user create/delete
/// and a settings save invalidate it.
/// </summary>
/// <remarks>
/// The LDAP half is not a nicety. Counting local users was the whole test, and an LDAP-only
/// install legitimately has none — so /api/auth/status answered authRequired=false, the SPA
/// never showed a login page, and every endpoint behind the gate opened to anyone who could
/// reach the port. Turning directory sign-in on has to turn authentication on with it.
/// </remarks>
public sealed class AuthService
{
    private const int Unknown = -1;
    private const int Disabled = 0;
    private const int Enabled = 1;

    /// <summary>The id claim of a session that came from the directory rather than the users
    /// table. Local ids start at 1, so it can never collide with a real account.</summary>
    public const string DirectoryPrincipalId = "0";

    private readonly IUserStore _users;
    private readonly ISettingsStore _settings;
    private volatile int _state = Unknown;

    // id -> still exists. Cleared whenever the user set changes, so a delete takes effect on the
    // deleted account's very next request instead of when its cookie happens to expire.
    private readonly ConcurrentDictionary<long, bool> _known = new();

    public AuthService(IUserStore users, ISettingsStore settings)
    {
        _users = users;
        _settings = settings;
    }

    public async ValueTask<bool> IsEnabledAsync(CancellationToken cancellationToken = default)
    {
        if (_state == Unknown)
        {
            var enabled = await _users.CountAsync(cancellationToken) > 0
                          || (await _settings.GetLdapSettingsAsync(cancellationToken)).Enabled;
            _state = enabled ? Enabled : Disabled;
        }
        return _state == Enabled;
    }

    /// <summary>Whether directory sign-in is offered, so the login page can show the choice.</summary>
    public async ValueTask<bool> IsLdapEnabledAsync(CancellationToken cancellationToken = default)
        => (await _settings.GetLdapSettingsAsync(cancellationToken)).Enabled;

    /// <summary>
    /// Whether the signed-in principal still corresponds to a real account.
    /// </summary>
    /// <remarks>
    /// Identity and role ride in the cookie so the gate costs no database read per request, but
    /// nothing re-checked that the account still existed: a deleted user kept working, with its
    /// original role, for the life of the cookie — seven days, renewed indefinitely by an open tab.
    /// Firing someone did not lock them out. This adds one cached lookup per user, not a read per
    /// request; the cache is invalidated on any create or delete.
    /// </remarks>
    public async ValueTask<bool> UserStillExistsAsync(
        ClaimsPrincipal principal, CancellationToken cancellationToken = default)
    {
        // A directory principal has no local row by design, so asking the users table whether it
        // still exists always answers no — and the gate would sign them straight back out on the
        // request after the one that logged them in. Their membership was checked at login and is
        // re-checked at the next one; the cookie lifetime is the window, same as for a local user.
        if (principal.FindFirstValue(ClaimTypes.NameIdentifier) == DirectoryPrincipalId)
        {
            return true;
        }
        if (!long.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id))
        {
            // a cookie issued before the id claim existed: fall back to the username
            var username = principal.Identity?.Name;
            return username is not null && (await _users.ListAsync(cancellationToken))
                .Any(user => user.Username == username);
        }
        if (_known.TryGetValue(id, out var exists))
        {
            return exists;
        }
        exists = await _users.FindAsync(id, cancellationToken) is not null;
        _known[id] = exists;
        return exists;
    }

    public void Invalidate()
    {
        _state = Unknown;
        _known.Clear();
    }
}
