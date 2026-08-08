using System.Text.Json;
using LogHarbor.Core.Events;
using LogHarbor.Core.Query;
using LogHarbor.Core.Storage;

namespace LogHarbor.Core.Alerting;

public interface IWebhookSender
{
    /// <summary>Posts the JSON payload; returns null on success or a short error description.</summary>
    Task<string?> SendAsync(string url, string jsonPayload, CancellationToken cancellationToken = default);
}

/// <summary>
/// Checks every enabled alert rule against the last WindowMinutes of events and fires
/// its webhook when the watched filter's match count reaches the threshold — the filter
/// being the rule's own or the signal's, whichever it was created with. After a firing the
/// rule stays quiet for one full window (cooldown), successful or not, so a dead
/// webhook is not hammered every evaluation. An acknowledged rule is skipped entirely
/// until its acknowledgement expires.
/// </summary>
public sealed class AlertEvaluator
{
    private static readonly JsonSerializerOptions PayloadOptions = new(JsonSerializerDefaults.Web);

    private readonly IAlertStore _alerts;
    private readonly IEventStore _events;
    private readonly IWebhookSender _webhooks;

    public AlertEvaluator(IAlertStore alerts, IEventStore events, IWebhookSender webhooks)
    {
        _alerts = alerts;
        _events = events;
        _webhooks = webhooks;
    }

    // a dead webhook costs the sender's full timeout, and evaluation used to await each one in
    // the rule loop: seven of them pushed a pass past the scheduler's one-minute tick and made
    // every rule, healthy ones included, evaluate late. Bounded so a burst cannot open hundreds
    // of sockets at once.
    private const int WebhookConcurrency = 4;

    /// <summary>Returns the number of webhooks fired successfully.</summary>
    public async Task<int> EvaluateAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var due = new List<(AlertRule Rule, string Payload)>();
        foreach (var alert in await _alerts.GetEnabledWithSignalAsync(cancellationToken))
        {
            var rule = alert.Rule;
            var toUtc = ClefParser.FormatTimestamp(now);
            var fromUtc = ClefParser.FormatTimestamp(now.AddMinutes(-rule.WindowMinutes));
            // acknowledged first, and before the count query: somebody has said they know, so
            // the cheapest correct thing is to do nothing at all. The rule is not touched, so
            // when the acknowledgement expires it fires again if the condition still holds —
            // which is the difference between acknowledging an alarm and disabling a rule.
            if (rule.IsAcknowledgedAt(toUtc))
            {
                continue;
            }
            if (rule.LastTriggeredAt is not null && string.CompareOrdinal(rule.LastTriggeredAt, fromUtc) > 0)
            {
                continue; // still cooling down
            }

            QuerySql filterSql;
            try
            {
                filterSql = SqlTranslator.Translate(QueryParser.Parse(alert.Filter));
            }
            catch (QueryParseException ex)
            {
                // the filter was edited into something unparseable after the rule was created —
                // name which one, since a rule's own filter and a shared signal are fixed in
                // different places
                var origin = alert.SignalTitle is null ? "filter" : "signal filter";
                await _alerts.SetErrorAsync(rule.Id, $"invalid {origin}: {ex.Message}", cancellationToken);
                continue;
            }

            var windowCount = (await _events.GetSummaryAsync(filterSql, fromUtc, toUtc, cancellationToken)).Total;

            long count;
            if (rule.Condition == "silence")
            {
                if (windowCount > 0)
                {
                    continue; // still alive
                }
                // proof of life: was the signal ever seen between rule creation and the window?
                var prior = await _events.GetSummaryAsync(filterSql, rule.CreatedAt, fromUtc, cancellationToken);
                if (prior.Total == 0)
                {
                    continue; // never alive (or younger than one window) -> nothing to mourn
                }
                count = 0;
            }
            else
            {
                if (windowCount < rule.ThresholdCount)
                {
                    continue;
                }
                count = windowCount;
            }

            due.Add((rule with { LastTriggeredAt = toUtc }, BuildPayload(
                rule, alert.SignalTitle, alert.Watching, alert.Filter, count, fromUtc, toUtc)));
        }

        if (due.Count == 0)
        {
            return 0;
        }

        var fired = 0;
        using var slots = new SemaphoreSlim(WebhookConcurrency);
        await Task.WhenAll(due.Select(async item =>
        {
            await slots.WaitAsync(cancellationToken);
            try
            {
                var error = await _webhooks.SendAsync(item.Rule.WebhookUrl, item.Payload, cancellationToken);
                // the trigger time is recorded whether or not the call succeeded, so a dead
                // webhook cools down like any other and is not hammered every evaluation
                await _alerts.MarkTriggeredAsync(
                    item.Rule.Id, item.Rule.LastTriggeredAt!, error, cancellationToken);
                if (error is null)
                {
                    Interlocked.Increment(ref fired);
                }
            }
            finally
            {
                slots.Release();
            }
        }));
        return fired;
    }

    /// <summary>Slack and Discord incoming webhooks reject arbitrary JSON — they require
    /// {"text"} / {"content"} respectively; everything else gets the structured payload.
    /// A silence payload carries condition:"silence" and count:0 instead of a threshold.
    /// The "signal" key stays in the structured payload and goes null for a rule that carries its
    /// own filter: a consumer reading it gets nothing rather than a filter expression dressed up
    /// as a signal name, and "filter" holds what was actually evaluated either way.</summary>
    private static string BuildPayload(
        AlertRule rule, string? signalTitle, string watching, string filter,
        long count, string fromUtc, string toUtc)
    {
        var message = rule.Condition == "silence"
            ? BuildSilenceMessage(rule, watching)
            : BuildMessage(rule, watching, count);

        switch (rule.PayloadFormat)
        {
            case "slack":
                return JsonSerializer.Serialize(new { text = message }, PayloadOptions);
            case "discord":
                return JsonSerializer.Serialize(new { content = message }, PayloadOptions);
            default:
                return rule.Condition == "silence"
                    ? JsonSerializer.Serialize(new
                    {
                        rule = rule.Title,
                        signal = signalTitle,
                        filter,
                        condition = "silence",
                        count,
                        windowMinutes = rule.WindowMinutes,
                        from = fromUtc,
                        to = toUtc,
                    }, PayloadOptions)
                    : JsonSerializer.Serialize(new
                    {
                        rule = rule.Title,
                        signal = signalTitle,
                        filter,
                        count,
                        threshold = rule.ThresholdCount,
                        windowMinutes = rule.WindowMinutes,
                        from = fromUtc,
                        to = toUtc,
                    }, PayloadOptions);
        }
    }

    private static string BuildMessage(AlertRule rule, string watching, long count) =>
        $"LogHarbor alert '{rule.Title}': {count} events matched '{watching}' " +
        $"in the last {rule.WindowMinutes} min (threshold {rule.ThresholdCount}).";

    private static string BuildSilenceMessage(AlertRule rule, string watching) =>
        $"LogHarbor alert '{rule.Title}': '{watching}' has been silent for " +
        $"{rule.WindowMinutes} min (expected at least one event).";
}
