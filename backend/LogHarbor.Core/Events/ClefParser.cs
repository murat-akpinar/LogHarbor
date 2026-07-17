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

            timestamp = ClampFuture(timestamp, serverTime);

            var messageTemplate = GetString(root, "@mt");
            var message = GetString(root, "@m")
                ?? (messageTemplate is null ? "" : RenderTemplate(messageTemplate, root));

            parsed = new Event(
                Id: 0,
                Timestamp: FormatTimestamp(timestamp),
                Level: Levels.FromAlias(GetString(root, "@l")),
                Message: message,
                MessageTemplate: messageTemplate,
                Properties: ExtractProperties(root),
                Exception: GetString(root, "@x"),
                IngestedAt: FormatTimestamp(serverTime),
                TraceId: NormalizeId(GetString(root, "@tr"), 32),
                SpanId: NormalizeId(GetString(root, "@sp"), 16));
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

    /// <summary>W3C ids are fixed-length hex and never all-zero; anything else stores as null
    /// rather than rejecting the event — same contract as OtlpLogParser.ToHexId, lowercased
    /// so @TraceId = '...' filters stay exact-match reliable across both ingestion paths.</summary>
    private static string? NormalizeId(string? value, int expectedLength)
    {
        if (value is null || value.Length != expectedLength)
        {
            return null;
        }
        var allZero = true;
        foreach (var c in value)
        {
            if (!char.IsAsciiHexDigit(c))
            {
                return null;
            }
            allZero &= c == '0';
        }
        return allZero ? null : value.ToLowerInvariant();
    }

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
