using System.Text.Json.Nodes;
using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Logs.V1;

namespace LogHarbor.Core.Events.Otlp;

/// <summary>
/// Parses OTLP/JSON payloads. The OTLP spec encodes trace_id/span_id as HEX strings in JSON,
/// deviating from proto3 JSON (base64 for bytes), so those fields are transcoded to base64
/// before Google.Protobuf's JsonParser sees the document.
/// </summary>
public static class OtlpJson
{
    // collectors may send fields from newer proto revisions; ignoring them is forward compatibility
    private static readonly JsonParser Parser =
        new(JsonParser.Settings.Default.WithIgnoreUnknownFields(true));

    public static bool TryParse(string json, out ExportLogsServiceRequest? request, out string? error)
    {
        request = null;
        JsonNode? root;
        try
        {
            root = JsonNode.Parse(json);
        }
        catch (System.Text.Json.JsonException)
        {
            error = "invalid JSON";
            return false;
        }
        if (root is not JsonObject rootObject)
        {
            error = "payload must be a JSON object";
            return false;
        }

        try
        {
            RewriteHexIds(rootObject);
            request = Parser.Parse<ExportLogsServiceRequest>(rootObject.ToJsonString());
        }
        catch (FormatException ex)
        {
            error = ex.Message;
            return false;
        }
        catch (InvalidProtocolBufferException ex)
        {
            error = ex.Message;
            return false;
        }

        error = null;
        return true;
    }

    private static void RewriteHexIds(JsonObject root)
    {
        foreach (var resourceLogs in ArrayOf(root, "resourceLogs", "resource_logs"))
        {
            foreach (var scopeLogs in ArrayOf(resourceLogs, "scopeLogs", "scope_logs"))
            {
                foreach (var record in ArrayOf(scopeLogs, "logRecords", "log_records"))
                {
                    RewriteId(record, "traceId", "trace_id");
                    RewriteId(record, "spanId", "span_id");
                }
            }
        }
    }

    // JsonParser accepts both camelCase and original snake_case field names; so must this walk
    private static IEnumerable<JsonObject> ArrayOf(JsonObject parent, string camel, string snake)
    {
        var array = parent[camel] as JsonArray ?? parent[snake] as JsonArray;
        if (array is null)
        {
            yield break;
        }
        foreach (var item in array)
        {
            if (item is JsonObject itemObject)
            {
                yield return itemObject;
            }
        }
    }

    private static void RewriteId(JsonObject record, string camel, string snake)
    {
        var key = record.ContainsKey(camel) ? camel : snake;
        if (record[key] is not JsonValue value || !value.TryGetValue<string>(out var hex))
        {
            return;
        }
        if (hex.Length == 0)
        {
            record.Remove(key);
            return;
        }
        byte[] bytes;
        try
        {
            bytes = Convert.FromHexString(hex);
        }
        catch (FormatException)
        {
            throw new FormatException($"{camel} must be a hex string");
        }
        record[key] = Convert.ToBase64String(bytes);
    }
}
