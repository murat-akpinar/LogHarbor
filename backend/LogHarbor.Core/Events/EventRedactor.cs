using System.Text.Json;
using System.Text.Json.Nodes;

namespace LogHarbor.Core.Events;

/// <summary>
/// Removes the values of named properties on the way in (docs/redaction.md).
///
/// Off unless an operator names something: whatever an application logs, this server stores
/// verbatim and forever, and dropping data at ingest is irreversible — so the list ships empty
/// and nothing here runs until someone fills it in.
///
/// The value is replaced rather than deleted. An operator reading an event has to be able to
/// tell "this request carried no Authorization header" from "it did, and this server refused to
/// keep it", and a missing key says the first while meaning the second.
/// </summary>
public static class EventRedactor
{
    /// <summary>What a redacted value reads as, in storage and on screen.</summary>
    public const string Placeholder = "[redacted]";

    /// <summary>
    /// Below this a value is not scrubbed out of a pre-rendered message.
    /// A two-character secret cannot be told from ordinary text by substring search, and
    /// blanking every "42" in a sentence damages the line to hide something already visible.
    /// Templated messages do not go through that path at all — they are re-rendered from the
    /// redacted properties, which is exact.
    /// </summary>
    private const int MinimumScrubLength = 3;

    /// <summary>
    /// The event as it should be stored: every property whose name matches one of
    /// <paramref name="deniedNames"/> holds <see cref="Placeholder"/>, nested objects and
    /// arrays included, and the message no longer spells out what the properties no longer say.
    /// Returns the event unchanged when the list is empty or nothing matched.
    /// </summary>
    /// <param name="deniedNames">
    /// Fragments, not exact names, matched case-insensitively: "token" covers AccessToken,
    /// refresh_token and X-Csrf-Token, which is what makes a short list worth keeping.
    /// </param>
    public static Event Apply(Event source, IReadOnlyList<string> deniedNames)
    {
        if (deniedNames.Count == 0 || source.Properties is null)
        {
            return source;
        }

        JsonNode? properties;
        try
        {
            properties = JsonNode.Parse(source.Properties);
        }
        catch (JsonException)
        {
            // stored properties are written by our own parsers, so this cannot normally happen;
            // an unreadable bag must not cost the event
            return source;
        }
        if (properties is null)
        {
            return source;
        }

        var removed = new List<string>();
        Walk(properties, deniedNames, removed);
        if (removed.Count == 0)
        {
            return source;
        }

        var json = properties.ToJsonString();
        return source with { Properties = json, Message = Rewrite(source, json, removed) };
    }

    /// <summary>
    /// The message, with what the properties no longer hold taken out of it too.
    ///
    /// A rendered message is the properties spelled into a sentence — redacting the bag and
    /// leaving "Signed in with hunter2" on the row would hide the secret from the property tree
    /// and from nowhere else. A templated event is re-rendered from the redacted bag, which is
    /// exactly what the sender would have produced; only an event that arrived pre-rendered
    /// (CLEF @m with no @mt) has to be edited as text.
    /// </summary>
    private static string Rewrite(Event source, string redactedJson, IReadOnlyList<string> removed)
    {
        var scrubbable = removed.Where(value => value.Length >= MinimumScrubLength).ToList();
        if (!scrubbable.Any(value => source.Message.Contains(value, StringComparison.Ordinal)))
        {
            return source.Message;
        }
        if (source.MessageTemplate is not null)
        {
            using var document = JsonDocument.Parse(redactedJson);
            return MessageTemplateRenderer.Render(source.MessageTemplate, document.RootElement);
        }
        var message = source.Message;
        foreach (var value in scrubbable)
        {
            message = message.Replace(value, Placeholder, StringComparison.Ordinal);
        }
        return message;
    }

    /// <summary>Replaces matching values in place, deepest first, collecting what they held.</summary>
    private static void Walk(JsonNode node, IReadOnlyList<string> deniedNames, List<string> removed)
    {
        switch (node)
        {
            case JsonObject json:
                // the keys are copied out first: replacing a value assigns into the object being
                // enumerated, which invalidates the enumerator
                foreach (var name in json.Select(pair => pair.Key).ToList())
                {
                    var value = json[name];
                    if (Matches(name, deniedNames))
                    {
                        if (value is not null && !IsPlaceholder(value))
                        {
                            removed.Add(Text(value));
                        }
                        json[name] = Placeholder;
                    }
                    else if (value is not null)
                    {
                        Walk(value, deniedNames, removed);
                    }
                }
                break;
            case JsonArray array:
                // an array element has no name of its own, so only the objects inside it can match
                foreach (var element in array)
                {
                    if (element is not null)
                    {
                        Walk(element, deniedNames, removed);
                    }
                }
                break;
        }
    }

    private static bool Matches(string name, IReadOnlyList<string> deniedNames)
    {
        foreach (var denied in deniedNames)
        {
            if (name.Contains(denied, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }

    private static bool IsPlaceholder(JsonNode node) =>
        node is JsonValue value && value.TryGetValue<string>(out var text) && text == Placeholder;

    /// <summary>What the value would have read as in a rendered message.</summary>
    private static string Text(JsonNode node) =>
        node is JsonValue value && value.TryGetValue<string>(out var text) ? text : node.ToJsonString();
}
