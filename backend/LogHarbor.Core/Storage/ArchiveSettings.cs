namespace LogHarbor.Core.Storage;

/// <summary>
/// Runtime-changeable archiving configuration (docs/archiving.md CONFIGURATION).
/// Values saved from the Settings page override the appsettings.json defaults.
/// </summary>
public sealed record ArchiveSettings
{
    public int CompressAfterDays { get; init; } = 90;
    public int HydrationKeepDays { get; init; } = 1;
    public int RetentionDays { get; init; } = 365;

    /// <summary>CompressAfterDays = 0 disables archiving; retention then deletes hot rows directly.</summary>
    public bool ArchivingEnabled => CompressAfterDays > 0;
}

public interface ISettingsStore
{
    Task<ArchiveSettings> GetArchiveSettingsAsync(CancellationToken cancellationToken = default);

    Task SaveArchiveSettingsAsync(ArchiveSettings settings, CancellationToken cancellationToken = default);
}
