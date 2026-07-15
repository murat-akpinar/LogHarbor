using System.Text.Json;

namespace LogHarbor.Core.Storage;

public sealed class SqliteSettingsStore : ISettingsStore
{
    private const string ArchiveKey = "archive";

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
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM settings WHERE key = @key;";
        command.Parameters.AddWithValue("@key", ArchiveKey);

        var value = (string?)await command.ExecuteScalarAsync(cancellationToken);
        return value is null
            ? _defaults
            : JsonSerializer.Deserialize<ArchiveSettings>(value, JsonOptions) ?? _defaults;
    }

    public async Task SaveArchiveSettingsAsync(ArchiveSettings settings, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO settings (key, value) VALUES (@key, @value) " +
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value;";
        command.Parameters.AddWithValue("@key", ArchiveKey);
        command.Parameters.AddWithValue("@value", JsonSerializer.Serialize(settings, JsonOptions));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
