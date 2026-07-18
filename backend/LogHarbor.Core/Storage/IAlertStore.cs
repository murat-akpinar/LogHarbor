namespace LogHarbor.Core.Storage;

/// <summary>Fires a webhook when a signal matches at least ThresholdCount events within WindowMinutes.
/// PayloadFormat picks the webhook body shape: generic (raw JSON), slack, discord.</summary>
public sealed record AlertRule(
    long Id,
    string Title,
    long SignalId,
    int ThresholdCount,
    int WindowMinutes,
    string WebhookUrl,
    bool IsEnabled,
    string CreatedAt,
    string? LastTriggeredAt,
    string? LastError,
    string PayloadFormat,
    string Condition);

/// <summary>An enabled rule joined with its signal, ready for evaluation.</summary>
public sealed record EnabledAlert(AlertRule Rule, string SignalTitle, string SignalFilter);

public interface IAlertStore
{
    /// <summary>
    /// Throws <see cref="DuplicateAlertTitleException"/> on a title conflict and
    /// <see cref="UnknownSignalException"/> when the signal id does not exist.
    /// </summary>
    Task<AlertRule> CreateAsync(
        string title, long signalId, int thresholdCount, int windowMinutes, string webhookUrl,
        bool isEnabled, string payloadFormat, string condition, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AlertRule>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>Returns null when id does not exist; same exceptions as CreateAsync.</summary>
    Task<AlertRule?> UpdateAsync(
        long id, string title, long signalId, int thresholdCount, int windowMinutes, string webhookUrl,
        bool isEnabled, string payloadFormat, string condition, CancellationToken cancellationToken = default);

    Task<bool> DeleteAsync(long id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<EnabledAlert>> GetEnabledWithSignalAsync(CancellationToken cancellationToken = default);

    /// <summary>Records a firing attempt; error is null when the webhook succeeded.</summary>
    Task MarkTriggeredAsync(long id, string atUtc, string? error, CancellationToken cancellationToken = default);

    /// <summary>Records an evaluation problem (e.g. unparseable signal filter) without a firing.</summary>
    Task SetErrorAsync(long id, string error, CancellationToken cancellationToken = default);
}

public sealed class DuplicateAlertTitleException(string title)
    : Exception($"An alert rule titled '{title}' already exists.");

public sealed class UnknownSignalException(long signalId)
    : Exception($"Signal {signalId} does not exist.");

/// <summary>The signal is referenced by at least one alert rule and cannot be deleted.</summary>
public sealed class SignalInUseException(long signalId)
    : Exception($"Signal {signalId} is used by an alert rule; delete the alert rule first.");
