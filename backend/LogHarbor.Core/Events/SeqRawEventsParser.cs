using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace LogHarbor.Core.Events;

/// <summary>Seq's second wire format for /api/events/raw: one JSON document holding an
/// "Events" array of {Timestamp, Level, MessageTemplate, Properties, Exception} objects.
/// seqlog and winston-seq send this instead of CLEF, so Seq compatibility needs both
/// (docs/ingestion-app.md).</summary>
public static class SeqRawEventsParser
{
    public const string EventsProperty = "Events";

    /// <summary>True when the body is the Events envelope rather than newline-delimited CLEF.
    /// Scans top-level keys only, without materializing values. CLEF's required @t settles the
    /// ambiguity of a single CLEF line that carries an "Events" array property of its own.
    /// A true result guarantees the body starts with an object holding an Events array, so the
    /// caller may read that property without re-checking.</summary>
    public static bool IsEnvelope(ReadOnlySpan<byte> utf8Body)
    {
        try
        {
            var reader = new Utf8JsonReader(utf8Body);
            if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
            {
                return false;
            }

            var hasEventsArray = false;
            while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
            {
                var isEvents = reader.ValueTextEquals(EventsProperty);
                var isClefTimestamp = reader.ValueTextEquals("@t");
                if (!reader.Read() || isClefTimestamp)
                {
                    return false;
                }
                hasEventsArray |= isEvents && reader.TokenType == JsonTokenType.StartArray;
                reader.Skip();
            }
            return hasEventsArray;
        }
        catch (JsonException)
        {
            // Trailing content after the first object: a CLEF batch, not an envelope.
            return false;
        }
    }

    /// <summary>Maps one element of the Events array onto an Event, applying the same
    /// normalization as the CLEF path (docs/data-model.md).</summary>
    public static bool TryParseEvent(
        JsonElement element, DateTimeOffset serverTime, out Event? parsed, out string? error)
    {
        parsed = null;

        if (element.ValueKind != JsonValueKind.Object)
        {
            error = "event must be a JSON object";
            return false;
        }

        if (!element.TryGetProperty("Timestamp", out var timestampElement)
            || timestampElement.ValueKind != JsonValueKind.String
            || !DateTimeOffset.TryParse(timestampElement.GetString(), CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal, out var timestamp))
        {
            error = "missing or unparseable Timestamp";
            return false;
        }

        var properties = GetObject(element, "Properties");
        var messageTemplate = GetString(element, "MessageTemplate");
        var message = GetString(element, "Message")
            ?? (messageTemplate is null ? "" : MessageTemplateRenderer.Render(messageTemplate, properties));

        parsed = new Event(
            Id: 0,
            Timestamp: ClefParser.FormatTimestamp(ClefParser.ClampFuture(timestamp, serverTime)),
            Level: Levels.FromAlias(GetString(element, "Level")),
            Message: message,
            MessageTemplate: messageTemplate,
            Properties: SerializeProperties(properties),
            Exception: GetString(element, "Exception"),
            IngestedAt: ClefParser.FormatTimestamp(serverTime));
        error = null;
        return true;
    }

    private static string? GetString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static JsonElement? GetObject(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    /// <summary>Re-serializes the bag so the stored column is compact regardless of how the
    /// client formatted the request, matching what the CLEF path writes.</summary>
    private static string? SerializeProperties(JsonElement? properties)
    {
        if (properties is not { } bag)
        {
            return null;
        }
        var result = new JsonObject();
        foreach (var property in bag.EnumerateObject())
        {
            result[property.Name] = JsonNode.Parse(property.Value.GetRawText());
        }
        return result.Count > 0 ? result.ToJsonString() : null;
    }
}
