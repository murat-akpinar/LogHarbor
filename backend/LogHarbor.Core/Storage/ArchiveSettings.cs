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

    /// <summary>
    /// Hard ceiling on the database file; 0 disables it. The other three settings are time
    /// policies, and time is the wrong unit for a disk: doubling the ingest rate fills the
    /// volume long before RetentionDays elapses, and the correct configuration for today
    /// becomes wrong when traffic changes. This is the brake that does not depend on
    /// predicting volume — over the ceiling, the oldest days go regardless of their age.
    /// </summary>
    public long MaxDatabaseBytes { get; init; }

    /// <summary>CompressAfterDays = 0 disables archiving; retention then deletes hot rows directly.</summary>
    public bool ArchivingEnabled => CompressAfterDays > 0;

    public bool SizeCapEnabled => MaxDatabaseBytes > 0;
}

public interface ISettingsStore
{
    Task<ArchiveSettings> GetArchiveSettingsAsync(CancellationToken cancellationToken = default);

    Task SaveArchiveSettingsAsync(ArchiveSettings settings, CancellationToken cancellationToken = default);

    /// <summary>Directory sign-in configuration. Holds no password — see LdapSettings.</summary>
    Task<Auth.LdapSettings> GetLdapSettingsAsync(CancellationToken cancellationToken = default);

    Task SaveLdapSettingsAsync(Auth.LdapSettings settings, CancellationToken cancellationToken = default);

    /// <summary>Property names dropped on the way in. Empty (the shipped state) means none.</summary>
    Task<RedactionSettings> GetRedactionSettingsAsync(CancellationToken cancellationToken = default);

    Task SaveRedactionSettingsAsync(RedactionSettings settings, CancellationToken cancellationToken = default);
}
