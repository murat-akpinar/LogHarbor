using Microsoft.AspNetCore.SignalR;
using LogHarbor.Core.Query;

namespace LogHarbor.Api.LiveTail;

public sealed class TailHub : Hub
{
    private readonly TailSubscriptions _subscriptions;

    public TailHub(TailSubscriptions subscriptions) => _subscriptions = subscriptions;

    /// <summary>Subscribes this connection to matching events; a null or blank filter tails everything.</summary>
    public void Subscribe(string? filter)
    {
        QuerySql? compiled = null;
        if (!string.IsNullOrWhiteSpace(filter))
        {
            try
            {
                compiled = SqlTranslator.Translate(QueryParser.Parse(filter));
            }
            catch (QueryParseException ex)
            {
                throw new HubException($"{ex.Message} (position {ex.Position})");
            }
        }
        _subscriptions.Set(Context.ConnectionId, compiled);
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        _subscriptions.Remove(Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}
