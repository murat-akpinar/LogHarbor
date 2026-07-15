namespace LogHarbor.Core.Storage;

public sealed record Signal(long Id, string Title, string Filter, string CreatedAt);

public interface ISignalStore
{
    /// <summary>Throws <see cref="DuplicateSignalTitleException"/> when title is already taken.</summary>
    Task<Signal> CreateAsync(string title, string filter, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Signal>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>Returns null when id does not exist. Throws <see cref="DuplicateSignalTitleException"/> on title conflict.</summary>
    Task<Signal?> UpdateAsync(long id, string title, string filter, CancellationToken cancellationToken = default);

    /// <summary>Returns false when id does not exist.</summary>
    Task<bool> DeleteAsync(long id, CancellationToken cancellationToken = default);
}

public sealed class DuplicateSignalTitleException(string title)
    : Exception($"A signal titled '{title}' already exists.");
