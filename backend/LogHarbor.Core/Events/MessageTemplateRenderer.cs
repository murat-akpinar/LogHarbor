using System.Text.Json;
using System.Text.RegularExpressions;

namespace LogHarbor.Core.Events;

/// <summary>Substitutes named tokens in a message template from a JSON object of property
/// values. Shared by the two wire formats, which hold those values in different places:
/// CLEF keeps them on the event root, Seq raw events in a nested "Properties" object.</summary>
internal static partial class MessageTemplateRenderer
{
    public static string Render(string template, JsonElement? properties) =>
        TemplateToken().Replace(template, match =>
        {
            var name = match.Groups[1].Value;
            return properties is { } values
                && values.ValueKind == JsonValueKind.Object
                && values.TryGetProperty(name, out var value)
                && value.ValueKind != JsonValueKind.Null
                    ? value.ToString()
                    : match.Value;
        });

    // {UserId}, {@Order}, {Elapsed:0.00} etc.; unmatched tokens are left as-is
    [GeneratedRegex(@"\{@?\$?(\w+)(?:[:,][^{}]*)?\}")]
    private static partial Regex TemplateToken();
}
