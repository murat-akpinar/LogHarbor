using System.Collections.Concurrent;
using System.Security.Claims;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Auth;

/// <summary>
/// Auth is enabled exactly when at least one user exists. The flag is cached because the
/// gate middleware asks on every request; user create/delete invalidates it.
/// </summary>
public sealed class AuthService
{
    private const int Unknown = -1;
    private const int Disabled = 0;
    private const int Enabled = 1;

    private readonly IUserStore _users;
    private volatile int _state = Unknown;

    // id -> still exists. Cleared whenever the user set changes, so a delete takes effect on the
    // deleted account's very next request instead of when its cookie happens to expire.
    private readonly ConcurrentDictionary<long, bool> _known = new();

    public AuthService(IUserStore users) => _users = users;

    public async ValueTask<bool> IsEnabledAsync(CancellationToken cancellationToken = default)
    {
        if (_state == Unknown)
        {
            _state = await _users.CountAsync(cancellationToken) > 0 ? Enabled : Disabled;
        }
        return _state == Enabled;
    }

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
