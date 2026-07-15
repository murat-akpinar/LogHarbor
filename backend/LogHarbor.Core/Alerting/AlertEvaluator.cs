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

            var summary = await _events.GetSummaryAsync(filterSql, fromUtc, toUtc, cancellationToken);
            if (summary.Total < rule.ThresholdCount)
            {
                continue;
            }

            var payload = JsonSerializer.Serialize(new
            {
                rule = rule.Title,
                signal = signalTitle,
                filter = signalFilter,
                count = summary.Total,
                threshold = rule.ThresholdCount,
                windowMinutes = rule.WindowMinutes,
                from = fromUtc,
                to = toUtc,
            }, PayloadOptions);

            var error = await _webhooks.SendAsync(rule.WebhookUrl, payload, cancellationToken);
            await _alerts.MarkTriggeredAsync(rule.Id, toUtc, error, cancellationToken);
            if (error is null)
            {
                fired++;
            }
        }
        return fired;
    }
}
