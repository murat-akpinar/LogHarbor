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
    /// <remarks>
    /// The caller's <paramref name="cancellationToken"/> is deliberately not forwarded to the
    /// per-subscriber work. It is the ingesting request's token, and the rows are committed by the
    /// time we get here — a sender that hangs up right after POSTing must not cancel delivery of
    /// data that is safely stored.
    /// </remarks>
    public async Task BroadcastAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0 || _subscriptions.IsEmpty)
        {
            return;
        }

        // one subscriber per iteration, each isolated: a connection that died between the
        // snapshot and the send used to abort the loop and drop the batch for everyone after it
        foreach (var (connectionId, filter) in _subscriptions.Snapshot())
        {
            try
            {
                var matched = await _eventStore.MatchAsync(filter, ids, CancellationToken.None);
                if (matched.Count > 0)
                {
                    await _hub.Clients.Client(connectionId)
                        .SendAsync("EventsArrived", matched, CancellationToken.None);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Live tail broadcast to {ConnectionId} failed for {EventCount} events.",
                    connectionId, ids.Count);
            }
        }
    }
}
