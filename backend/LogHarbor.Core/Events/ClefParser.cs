using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace LogHarbor.Core.Events;

/// <summary>Parses one CLEF JSON line into an Event, applying the normalization
/// rules from docs/data-model.md (fixed UTC timestamp format, future clamp, level aliases).</summary>
public static partial class ClefParser
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

            // a client with a broken clock must not create rows that never age into the archive
            if (timestamp > serverTime + FutureTolerance)
            {
                timestamp = serverTime;
            }

            var messageTemplate = GetString(root, "@mt");
            var message = GetString(root, "@m")
                ?? (messageTemplate is null ? "" : RenderTemplate(messageTemplate, root));

            parsed = new Event(
                Id: 0,
                Timestamp: FormatTimestamp(timestamp),
                Level: MapLevel(GetString(root, "@l")),
                Message: message,
                MessageTemplate: messageTemplate,
                Properties: ExtractProperties(root),
                Exception: GetString(root, "@x"),
                IngestedAt: FormatTimestamp(serverTime));
            error = null;
            return true;
        }
    }

    public static string FormatTimestamp(DateTimeOffset value) =>
        value.ToUniversalTime().ToString(TimestampFormat, CultureInfo.InvariantCulture);

    private static string? GetString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string MapLevel(string? level) => level?.Trim().ToLowerInvariant() switch
    {
        "verbose" or "trace" => "Verbose",
        "debug" => "Debug",
        "warning" or "warn" => "Warning",
        "error" or "err" => "Error",
        "fatal" or "critical" or "crit" => "Fatal",
        _ => "Information", // includes missing @l and unknown values (docs/data-model.md)
    };

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

    private static string RenderTemplate(string template, JsonElement root) =>
        TemplateToken().Replace(template, match =>
        {
            var name = match.Groups[1].Value;
            return root.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null
                ? value.ToString()
                : match.Value;
        });

    // {UserId}, {@Order}, {Elapsed:0.00} etc.; unmatched tokens are left as-is
    [GeneratedRegex(@"\{@?\$?(\w+)(?:[:,][^{}]*)?\}")]
    private static partial Regex TemplateToken();
}
