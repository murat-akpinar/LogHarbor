using Microsoft.AspNetCore.SignalR;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.LiveTail;

public sealed class TailBroadcaster
{
    private readonly IHubContext<TailHub> _hub;
    private readonly IEventStore _eventStore;
    private readonly TailSubscriptions _subscriptions;
    private readonly ILogger<TailBroadcaster> _logger;

    public TailBroadcaster(
        IHubContext<TailHub> hub,
        IEventStore eventStore,
        TailSubscriptions subscriptions,
        ILogger<TailBroadcaster> logger)
    {
        _hub = hub;
        _eventStore = eventStore;
        _subscriptions = subscriptions;
        _logger = logger;
    }

    /// <summary>
    /// Pushes the just-inserted events to every subscriber whose filter matches them.
    /// Never throws: the events are already committed, so a live-tail failure must not fail ingestion.
    /// </summary>
    public async Task BroadcastAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0 || _subscriptions.IsEmpty)
        {
            return;
        }

        try
        {
            foreach (var (connectionId, filter) in _subscriptions.Snapshot())
            {
                var matched = await _eventStore.MatchAsync(filter, ids, cancellationToken);
                if (matched.Count > 0)
                {
                    await _hub.Clients.Client(connectionId).SendAsync("EventsArrived", matched, cancellationToken);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Live tail broadcast failed for {EventCount} events.", ids.Count);
        }
    }
}
