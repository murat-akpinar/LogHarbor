namespace LogHarbor.Core.Storage;

/// <summary>Fires a webhook when the watched filter matches at least ThresholdCount events within
/// WindowMinutes. The filter comes either from a saved signal (SignalId) or from the rule itself
/// (Filter) — exactly one of the two.
/// PayloadFormat picks the webhook body shape: generic (raw JSON), slack, discord.
/// AcknowledgedUntil suppresses the firing until that instant and then expires by itself.</summary>
public sealed record AlertRule(
    long Id,
    string Title,
    /// <summary>The saved signal this watches, or null when the rule carries its own Filter.</summary>
    long? SignalId,
    int ThresholdCount,
    int WindowMinutes,
    string WebhookUrl,
    bool IsEnabled,
    string CreatedAt,
    string? LastTriggeredAt,
    string? LastError,
    string PayloadFormat,
    string Condition,
    string? AcknowledgedUntil = null,
    string? AcknowledgedBy = null,
    /// <summary>The rule's own filter expression, when it watches one directly. Exactly one of
    /// this and SignalId is set — the schema checks it too.</summary>
    string? Filter = null)
{
    /// <summary>Whether the rule is silenced at <paramref name="nowUtc"/>. Ordinal comparison is
    /// exact here: both are fixed-width UTC ISO-8601, so string order is chronological order.</summary>
    public bool IsAcknowledgedAt(string nowUtc) =>
        AcknowledgedUntil is not null && string.CompareOrdinal(AcknowledgedUntil, nowUtc) > 0;
}

/// <summary>
/// An enabled rule with whatever names its condition, ready for evaluation. A rule that carries
/// its own filter has no signal, so both fall back to the rule: Filter is what gets evaluated
/// and Watching is what the webhook message calls it.
/// </summary>
public sealed record EnabledAlert(AlertRule Rule, string? SignalTitle, string? SignalFilter)
{
    /// <summary>The filter to evaluate: the rule's own where it has one, the signal's otherwise.
    /// The schema's CHECK guarantees one of the two, so the throw is a broken database, not a
    /// case a caller has to handle.</summary>
    public string Filter => Rule.Filter ?? SignalFilter
        ?? throw new InvalidOperationException($"Alert rule {Rule.Id} has neither a filter nor a signal.");

    /// <summary>What to call the thing being watched, in the webhook payload and its message:
    /// the signal's name where there is one, the filter text itself otherwise.</summary>
    public string Watching => SignalTitle ?? Filter;
}

public interface IAlertStore
{
    /// <summary>
    /// Pass either a signalId or a filter, never both and never neither — the schema's CHECK
    /// rejects the other two combinations. Throws <see cref="DuplicateAlertTitleException"/> on a
    /// title conflict and <see cref="UnknownSignalException"/> when the signal id does not exist.
    /// </summary>
    Task<AlertRule> CreateAsync(
        string title, long? signalId, string? filter, int thresholdCount, int windowMinutes, string webhookUrl,
        bool isEnabled, string payloadFormat, string condition, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AlertRule>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>Returns null when id does not exist; same exceptions as CreateAsync.</summary>
    Task<AlertRule?> UpdateAsync(
        long id, string title, long? signalId, string? filter, int thresholdCount, int windowMinutes,
        string webhookUrl, bool isEnabled, string payloadFormat, string condition,
        CancellationToken cancellationToken = default);

    Task<bool> DeleteAsync(long id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<EnabledAlert>> GetEnabledWithSignalAsync(CancellationToken cancellationToken = default);

    /// <summary>Records a firing attempt; error is null when the webhook succeeded.</summary>
    Task MarkTriggeredAsync(long id, string atUtc, string? error, CancellationToken cancellationToken = default);

    /// <summary>Records an evaluation problem (e.g. unparseable signal filter) without a firing.</summary>
    Task SetErrorAsync(long id, string error, CancellationToken cancellationToken = default);

    /// <summary>
    /// Silences a rule until <paramref name="untilUtc"/>, or lifts the silence when it is null.
    /// Returns the updated rule, or null when the id does not exist.
    /// </summary>
    Task<AlertRule?> AcknowledgeAsync(
        long id, string? untilUtc, string? by, CancellationToken cancellationToken = default);
}

public sealed class DuplicateAlertTitleException(string title)
    : Exception($"An alert rule titled '{title}' already exists.");

public sealed class UnknownSignalException(long signalId)
    : Exception($"Signal {signalId} does not exist.");

/// <summary>The signal is referenced by at least one alert rule and cannot be deleted.</summary>
public sealed class SignalInUseException(long signalId)
    : Exception($"Signal {signalId} is used by an alert rule; delete the alert rule first.");
