namespace LogHarbor.Core.Storage;

public sealed record ApiKey(long Id, string Title, string CreatedAt, bool IsActive);

/// <summary>Returned only at creation; the raw token is never stored or shown again.</summary>
public sealed record CreatedApiKey(long Id, string Title, string Token, string CreatedAt);

public interface IApiKeyStore
{
    Task<CreatedApiKey> CreateAsync(string title, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ApiKey>> ListAsync(CancellationToken cancellationToken = default);
    /// <summary>Sets is_active = 0. Returns false when the id does not exist.</summary>
    Task<bool> RevokeAsync(long id, CancellationToken cancellationToken = default);
    /// <summary>Returns the key id when the token matches an active key, otherwise null.</summary>
    Task<long?> AuthenticateAsync(string token, CancellationToken cancellationToken = default);
}
