using System.Text;
using System.Text.Json;
using LogHarbor.Core.Events;
using LogHarbor.Core.Query;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class ExportEndpoints
{
    private const int PageSize = 1000;
    private const int DefaultLimit = 10_000;
    private const int MaxLimit = 100_000;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    public static void MapExport(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/events/export", ExportAsync);
    }

    private static async Task<IResult> ExportAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string? filter = null,
        string? from = null,
        string? to = null,
        string format = "json",
        int limit = DefaultLimit)
    {
        if (format is not ("json" or "csv"))
        {
            return BadRequest("format must be 'json' or 'csv'.");
        }
        if (limit is < 1 or > MaxLimit)
        {
            return BadRequest($"limit must be between 1 and {MaxLimit}.");
        }
        if (!TryNormalize(from, out var fromUtc) || !TryNormalize(to, out var toUtc))
        {
            return BadRequest("from/to must be valid ISO-8601 timestamps.");
        }

        QuerySql? filterSql = null;
        if (!string.IsNullOrWhiteSpace(filter))
        {
            try
            {
                filterSql = SqlTranslator.Translate(QueryParser.Parse(filter));
            }
            catch (QueryParseException ex)
            {
                return BadRequest($"invalid filter: {ex.Message} (position {ex.Position})");
            }
        }

        // one cheap page first, only to learn whether the range touches cold storage. A file
        // leaves the system — someone attaches it to a ticket believing it covers the range —
        // and archived days would be missing with no visible seam, the surrounding days all
        // present. Refuse rather than write a quietly incomplete export.
        var probe = await eventStore.QueryAsync(
            new EventQuery(filterSql, fromUtc, toUtc, null, 1), cancellationToken);
        if (probe.ArchivedDays.Count > 0)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Range contains archived days",
                detail: $"{string.Join(", ", probe.ArchivedDays)} " +
                    $"{(probe.ArchivedDays.Count == 1 ? "is" : "are")} compressed to cold storage and would be " +
                    "missing from the export. Extract the range first (Events page, or " +
                    "POST /api/archive/hydrate), then export again.");
        }

        var stamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss");
        var query = new EventQuery(filterSql, fromUtc, toUtc, null, 0);
        // streamed page by page: buffering MaxLimit events into a List and then into a byte[]
        // meant a couple of hundred MB of peak allocation per request on a box whose whole
        // point is running small
        return format == "json"
            ? Results.Stream(
                stream => WriteJsonAsync(stream, eventStore, query, limit, cancellationToken),
                "application/json", $"logharbor-events-{stamp}.json")
            : Results.Stream(
                stream => WriteCsvAsync(stream, eventStore, query, limit, cancellationToken),
                "text/csv", $"logharbor-events-{stamp}.csv");
    }

    /// <summary>Walks the same keyset pages the search uses, newest first, up to limit.</summary>
    private static async IAsyncEnumerable<Event> ReadPagesAsync(
        IEventStore eventStore, EventQuery query, int limit,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var written = 0;
        long? afterId = null;
        while (written < limit)
        {
            var count = Math.Min(PageSize, limit - written);
            var page = await eventStore.QueryAsync(query with { AfterId = afterId, Count = count }, cancellationToken);
            foreach (var item in page.Events)
            {
                yield return item;
                written++;
            }
            if (!page.HasMore || page.Events.Count == 0)
            {
                yield break;
            }
            afterId = page.Events[^1].Id;
        }
    }

    private static readonly byte[] ArrayOpen = "[\n"u8.ToArray();
    private static readonly byte[] ElementSeparator = ",\n"u8.ToArray();
    private static readonly byte[] ArrayClose = "\n]\n"u8.ToArray();

    /// <summary>
    /// Elements are serialized one at a time and written straight to the body. Utf8JsonWriter is
    /// deliberately not used: JsonSerializer.Serialize(writer, ...) flushes the writer when it
    /// finishes, and a synchronous flush onto the response stream is exactly what ASP.NET forbids.
    /// </summary>
    private static async Task WriteJsonAsync(
        Stream output, IEventStore eventStore, EventQuery query, int limit, CancellationToken cancellationToken)
    {
        await output.WriteAsync(ArrayOpen, cancellationToken);
        var first = true;
        await foreach (var item in ReadPagesAsync(eventStore, query, limit, cancellationToken))
        {
            if (!first)
            {
                await output.WriteAsync(ElementSeparator, cancellationToken);
            }
            first = false;
            await output.WriteAsync(JsonSerializer.SerializeToUtf8Bytes(item, JsonOptions), cancellationToken);
        }
        await output.WriteAsync(ArrayClose, cancellationToken);
    }

    private static async Task WriteCsvAsync(
        Stream output, IEventStore eventStore, EventQuery query, int limit, CancellationToken cancellationToken)
    {
        await using var writer = new StreamWriter(output, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        await writer.WriteAsync(
            "id,timestamp,level,message,messageTemplate,properties,exception,ingestedAt,traceId,spanId\n");

        var row = new StringBuilder();
        await foreach (var item in ReadPagesAsync(eventStore, query, limit, cancellationToken))
        {
            row.Clear();
            row.Append(item.Id).Append(',');
            row.Append(CsvCell(item.Timestamp)).Append(',');
            row.Append(CsvCell(item.Level)).Append(',');
            row.Append(CsvCell(item.Message)).Append(',');
            row.Append(CsvCell(item.MessageTemplate)).Append(',');
            row.Append(CsvCell(item.Properties)).Append(',');
            row.Append(CsvCell(item.Exception)).Append(',');
            row.Append(CsvCell(item.IngestedAt)).Append(',');
            row.Append(CsvCell(item.TraceId)).Append(',');
            row.Append(CsvCell(item.SpanId)).Append('\n');
            await writer.WriteAsync(row, cancellationToken);
        }
        await writer.FlushAsync(cancellationToken);
    }

    private static string CsvCell(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "";
        }
        // log content is untrusted: a leading =, +, - or @ would execute as a formula
        // when the file is opened in a spreadsheet (rules.md: log messages are untrusted input)
        if (value[0] is '=' or '+' or '-' or '@')
        {
            value = "'" + value;
        }
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    /// <summary>Same normalization as the search endpoint, so exports match what the UI shows.</summary>
    private static bool TryNormalize(string? input, out string? normalized)
    {
        normalized = null;
        if (string.IsNullOrWhiteSpace(input))
        {
            return true;
        }
        if (!TimestampParsing.TryParseUtc(input, out var parsed))
        {
            return false;
        }
        normalized = ClefParser.FormatTimestamp(parsed);
        return true;
    }

    private static IResult BadRequest(string detail) =>
        Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid export request", detail: detail);
}
