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

        var events = new List<Event>();
        long? afterId = null;
        while (events.Count < limit)
        {
            var count = Math.Min(PageSize, limit - events.Count);
            var page = await eventStore.QueryAsync(
                new EventQuery(filterSql, fromUtc, toUtc, afterId, count), cancellationToken);
            events.AddRange(page.Events);
            if (!page.HasMore || page.Events.Count == 0)
            {
                break;
            }
            afterId = page.Events[^1].Id;
        }

        var stamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss");
        return format == "json"
            ? Results.File(
                JsonSerializer.SerializeToUtf8Bytes(events, JsonOptions),
                "application/json", $"logharbor-events-{stamp}.json")
            : Results.File(
                Encoding.UTF8.GetBytes(ToCsv(events)),
                "text/csv", $"logharbor-events-{stamp}.csv");
    }

    private static string ToCsv(IReadOnlyList<Event> events)
    {
        var csv = new StringBuilder();
        csv.Append("id,timestamp,level,message,messageTemplate,properties,exception,ingestedAt\n");
        foreach (var item in events)
        {
            csv.Append(item.Id).Append(',');
            csv.Append(CsvCell(item.Timestamp)).Append(',');
            csv.Append(CsvCell(item.Level)).Append(',');
            csv.Append(CsvCell(item.Message)).Append(',');
            csv.Append(CsvCell(item.MessageTemplate)).Append(',');
            csv.Append(CsvCell(item.Properties)).Append(',');
            csv.Append(CsvCell(item.Exception)).Append(',');
            csv.Append(CsvCell(item.IngestedAt)).Append('\n');
        }
        return csv.ToString();
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
