using System.Text.Json.Nodes;
using OpenTelemetry.Proto.Common.V1;

namespace LogHarbor.Core.Events.Otlp;

/// <summary>Converts OTLP AnyValue/KeyValue trees to JSON for the properties column.</summary>
public static class OtlpValues
{
    public static JsonNode? ToJsonNode(AnyValue? value) => value?.ValueCase switch
    {
        AnyValue.ValueOneofCase.StringValue => JsonValue.Create(value.StringValue),
        AnyValue.ValueOneofCase.BoolValue => JsonValue.Create(value.BoolValue),
        AnyValue.ValueOneofCase.IntValue => JsonValue.Create(value.IntValue),
        AnyValue.ValueOneofCase.DoubleValue => JsonValue.Create(value.DoubleValue),
        AnyValue.ValueOneofCase.BytesValue => JsonValue.Create(value.BytesValue.ToBase64()),
        AnyValue.ValueOneofCase.ArrayValue => ToJsonArray(value.ArrayValue),
        AnyValue.ValueOneofCase.KvlistValue => ToJsonObject(value.KvlistValue.Values),
        // None or null: an empty AnyValue carries no information
        _ => null,
    };

    public static JsonObject ToJsonObject(IEnumerable<KeyValue> values)
    {
        var result = new JsonObject();
        foreach (var item in values)
        {
            // indexer, not Add: OTLP does not forbid duplicate keys, last one wins
            result[item.Key] = ToJsonNode(item.Value);
        }
        return result;
    }

    private static JsonArray ToJsonArray(ArrayValue array)
    {
        var result = new JsonArray();
        foreach (var item in array.Values)
        {
            result.Add(ToJsonNode(item));
        }
        return result;
    }
}
