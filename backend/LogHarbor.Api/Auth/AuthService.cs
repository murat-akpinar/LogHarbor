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

    public AuthService(IUserStore users) => _users = users;

    public async ValueTask<bool> IsEnabledAsync(CancellationToken cancellationToken = default)
    {
        if (_state == Unknown)
        {
            _state = await _users.CountAsync(cancellationToken) > 0 ? Enabled : Disabled;
        }
        return _state == Enabled;
    }

    public void Invalidate() => _state = Unknown;
}
