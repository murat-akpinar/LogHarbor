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
/// its webhook when the signal's match count reaches the threshold. After a firing the
/// rule stays quiet for one full window (cooldown), successful or not, so a dead
/// webhook is not hammered every evaluation.
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

    /// <summary>Returns the number of webhooks fired successfully.</summary>
    public async Task<int> EvaluateAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var fired = 0;
        foreach (var (rule, signalTitle, signalFilter) in await _alerts.GetEnabledWithSignalAsync(cancellationToken))
        {
            var toUtc = ClefParser.FormatTimestamp(now);
            var fromUtc = ClefParser.FormatTimestamp(now.AddMinutes(-rule.WindowMinutes));
            if (rule.LastTriggeredAt is not null && string.CompareOrdinal(rule.LastTriggeredAt, fromUtc) > 0)
            {
                continue; // still cooling down
            }

            QuerySql filterSql;
            try
            {
                filterSql = SqlTranslator.Translate(QueryParser.Parse(signalFilter));
            }
            catch (QueryParseException ex)
            {
                // the signal was edited into something unparseable after the rule was created
                await _alerts.SetErrorAsync(rule.Id, $"invalid signal filter: {ex.Message}", cancellationToken);
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

            var payload = BuildPayload(rule, signalTitle, signalFilter, count, fromUtc, toUtc);

            var error = await _webhooks.SendAsync(rule.WebhookUrl, payload, cancellationToken);
            await _alerts.MarkTriggeredAsync(rule.Id, toUtc, error, cancellationToken);
            if (error is null)
            {
                fired++;
            }
        }
        return fired;
    }

    /// <summary>Slack and Discord incoming webhooks reject arbitrary JSON — they require
    /// {"text"} / {"content"} respectively; everything else gets the structured payload.
    /// A silence payload carries condition:"silence" and count:0 instead of a threshold.</summary>
    private static string BuildPayload(
        AlertRule rule, string signalTitle, string signalFilter, long count, string fromUtc, string toUtc)
    {
        var message = rule.Condition == "silence"
            ? BuildSilenceMessage(rule, signalTitle)
            : BuildMessage(rule, signalTitle, count);

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
                        filter = signalFilter,
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
                        filter = signalFilter,
                        count,
                        threshold = rule.ThresholdCount,
                        windowMinutes = rule.WindowMinutes,
                        from = fromUtc,
                        to = toUtc,
                    }, PayloadOptions);
        }
    }

    private static string BuildMessage(AlertRule rule, string signalTitle, long count) =>
        $"LogHarbor alert '{rule.Title}': {count} events matched '{signalTitle}' " +
        $"in the last {rule.WindowMinutes} min (threshold {rule.ThresholdCount}).";

    private static string BuildSilenceMessage(AlertRule rule, string signalTitle) =>
        $"LogHarbor alert '{rule.Title}': signal '{signalTitle}' has been silent for " +
        $"{rule.WindowMinutes} min (expected at least one event).";
}
