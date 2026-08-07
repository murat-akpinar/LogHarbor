using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

/// <summary>
/// The one step between parsing a batch and storing it (docs/redaction.md).
///
/// Every wire format goes through here, which is the point: a format added later that writes
/// straight to the store would keep the values an operator has told this server not to keep,
/// and nothing would say so.
/// </summary>
internal static class Redaction
{
    /// <summary>
    /// The batch as it should be stored. Reads the deny-list per batch rather than caching it:
    /// one indexed row from the settings table, against one INSERT per event in the same batch,
    /// and a cache would let a list saved in Settings go on being ignored for as long as it
    /// lived — which is the one failure this feature cannot have.
    /// </summary>
    public static async Task<IReadOnlyList<Event>> ApplyAsync(
        IReadOnlyList<Event> events, ISettingsStore settingsStore, CancellationToken cancellationToken)
    {
        if (events.Count == 0)
        {
            return events;
        }
        var settings = await settingsStore.GetRedactionSettingsAsync(cancellationToken);
        if (!settings.Enabled)
        {
            return events;
        }
        var redacted = new List<Event>(events.Count);
        foreach (var item in events)
        {
            redacted.Add(EventRedactor.Apply(item, settings.Properties));
        }
        return redacted;
    }
}
