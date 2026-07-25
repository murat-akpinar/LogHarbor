using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace LogHarbor.Core.Events;

/// <summary>Parses one CLEF JSON line into an Event, applying the normalization
/// rules from docs/data-model.md (fixed UTC timestamp format, future clamp, level aliases).</summary>
public static class ClefParser
{
    public const string TimestampFormat = "yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'";

    private static readonly TimeSpan FutureTolerance = TimeSpan.FromMinutes(5);

    public static bool TryParse(string line, DateTimeOffset serverTime, out Event? parsed, out string? error)
    {
        parsed = null;

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(line);
        }
        catch (JsonException)
        {
            error = "invalid JSON";
            return false;
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                error = "event must be a JSON object";
                return false;
            }

            if (!root.TryGetProperty("@t", out var timestampElement)
                || timestampElement.ValueKind != JsonValueKind.String
                || !DateTimeOffset.TryParse(timestampElement.GetString(), CultureInfo.InvariantCulture,
                        DateTimeStyles.AssumeUniversal, out var timestamp))
            {
                error = "missing or unparseable @t";
                return false;
            }

            timestamp = ClampFuture(timestamp, serverTime);

            var messageTemplate = GetString(root, "@mt");
            var message = GetString(root, "@m")
                ?? (messageTemplate is null ? "" : MessageTemplateRenderer.Render(messageTemplate, root));

            parsed = new Event(
                Id: 0,
                Timestamp: FormatTimestamp(timestamp),
                Level: Levels.FromAlias(GetString(root, "@l")),
                Message: message,
                MessageTemplate: messageTemplate,
                Properties: ExtractProperties(root),
                Exception: GetString(root, "@x"),
                IngestedAt: FormatTimestamp(serverTime),
                TraceId: TraceIds.NormalizeTrace(GetString(root, "@tr")),
                SpanId: TraceIds.NormalizeSpan(GetString(root, "@sp")));
            error = null;
            return true;
        }
    }

    public static string FormatTimestamp(DateTimeOffset value) =>
        value.ToUniversalTime().ToString(TimestampFormat, CultureInfo.InvariantCulture);

    /// <summary>A client with a broken clock must not create rows that never age into the archive.</summary>
    public static DateTimeOffset ClampFuture(DateTimeOffset value, DateTimeOffset serverTime) =>
        value > serverTime + FutureTolerance ? serverTime : value;

    private static string? GetString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string? ExtractProperties(JsonElement root)
    {
        var properties = new JsonObject();
        foreach (var property in root.EnumerateObject())
        {
            if (!property.Name.StartsWith('@'))
            {
                properties[property.Name] = JsonNode.Parse(property.Value.GetRawText());
            }
        }
        return properties.Count > 0 ? properties.ToJsonString() : null;
    }
}
