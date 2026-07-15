using System.Collections.Concurrent;
using LogHarbor.Core.Query;

namespace LogHarbor.Api.LiveTail;

/// <summary>Connection id -> the subscriber's compiled filter (null means "everything").</summary>
public sealed class TailSubscriptions
{
    private readonly ConcurrentDictionary<string, QuerySql?> _filters = new();

    public bool IsEmpty => _filters.IsEmpty;

    public void Set(string connectionId, QuerySql? filter) => _filters[connectionId] = filter;

    public void Remove(string connectionId) => _filters.TryRemove(connectionId, out _);

    public IReadOnlyList<KeyValuePair<string, QuerySql?>> Snapshot() => _filters.ToArray();
}
