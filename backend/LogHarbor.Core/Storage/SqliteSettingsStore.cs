using System.Text.Json;
using LogHarbor.Core.Auth;

namespace LogHarbor.Core.Storage;

public sealed class SqliteSettingsStore : ISettingsStore
{
    private const string ArchiveKey = "archive";
    private const string LdapKey = "ldap";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly LogHarborDb _db;
    private readonly ArchiveSettings _defaults;

    /// <param name="defaults">Used until settings are saved once; comes from appsettings.json.</param>
    public SqliteSettingsStore(LogHarborDb db, ArchiveSettings defaults)
    {
        _db = db;
        _defaults = defaults;
    }

    public async Task<ArchiveSettings> GetArchiveSettingsAsync(CancellationToken cancellationToken = default)
        => await LoadAsync(ArchiveKey, cancellationToken) is { } json
            ? JsonSerializer.Deserialize<ArchiveSettings>(json, JsonOptions) ?? _defaults
            : _defaults;

    public Task SaveArchiveSettingsAsync(ArchiveSettings settings, CancellationToken cancellationToken = default)
        => SaveAsync(ArchiveKey, JsonSerializer.Serialize(settings, JsonOptions), cancellationToken);

    /// <summary>Unconfigured reads back as the disabled default, so an install that never opened
    /// the card behaves exactly like one that opened it and left LDAP off.</summary>
    public async Task<LdapSettings> GetLdapSettingsAsync(CancellationToken cancellationToken = default)
        => await LoadAsync(LdapKey, cancellationToken) is { } json
            ? JsonSerializer.Deserialize<LdapSettings>(json, JsonOptions) ?? new LdapSettings()
            : new LdapSettings();

    public Task SaveLdapSettingsAsync(LdapSettings settings, CancellationToken cancellationToken = default)
        => SaveAsync(LdapKey, JsonSerializer.Serialize(settings, JsonOptions), cancellationToken);

    private async Task<string?> LoadAsync(string key, CancellationToken cancellationToken)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM settings WHERE key = @key;";
        command.Parameters.AddWithValue("@key", key);
        return (string?)await command.ExecuteScalarAsync(cancellationToken);
    }

    private async Task SaveAsync(string key, string value, CancellationToken cancellationToken)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO settings (key, value) VALUES (@key, @value) " +
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value;";
        command.Parameters.AddWithValue("@key", key);
        command.Parameters.AddWithValue("@value", value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
