using System.Threading.Channels;

namespace LogHarbor.Api.Archiving;

/// <summary>
/// Days claimed for hydration (status already set to 'hydrating'), waiting for the
/// <see cref="HydrationWorker"/> to load them. Unbounded is safe: entries are capped
/// by the number of archive segments.
/// </summary>
public sealed class HydrationQueue
{
    private readonly Channel<string> _days = Channel.CreateUnbounded<string>();

    public void Enqueue(string day) => _days.Writer.TryWrite(day);

    public IAsyncEnumerable<string> ReadAllAsync(CancellationToken cancellationToken) =>
        _days.Reader.ReadAllAsync(cancellationToken);
}
