using LogHarbor.Core.Events;
using LogHarbor.Core.Query;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class StatsEndpoints
{
    public static void MapStats(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/stats");

        group.MapGet("/histogram", HistogramAsync);
        group.MapGet("/heatmap", HeatmapAsync);
        group.MapGet("/summary", SummaryAsync);
        group.MapGet("/top-errors", TopErrorsAsync);
        group.MapGet("/top-exceptions", TopExceptionsAsync);
        group.MapGet("/slow-operations", SlowOperationsAsync);
        group.MapGet("/property-values", PropertyValuesAsync);
    }

    private static readonly string[] DefaultErrorLevels = ["Error", "Fatal"];

    // events before this predate the server; used as the open-ended baseline start for slow-operations
    private const string BaselineStart = "2000-01-01T00:00:00.0000000Z";

    private static async Task<IResult> TopErrorsAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null,
        string[]? levels = null,
        int limit = 20)
    {
        if (!TryValidateCommon(from, to, filter, limit, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }
        var effectiveLevels = levels is { Length: > 0 } ? levels : DefaultErrorLevels;
        var unknown = effectiveLevels.FirstOrDefault(level => !Levels.All.Contains(level));
        if (unknown is not null)
        {
            return BadRequest("Invalid query", $"unknown level '{unknown}'.");
        }

        var errors = await eventStore.GetTopErrorsAsync(
            filterSql, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            effectiveLevels, limit, cancellationToken);
        return Results.Ok(new { errors });
    }

    private static async Task<IResult> TopExceptionsAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null,
        int limit = 20)
    {
        if (!TryValidateCommon(from, to, filter, limit, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }

        var exceptions = await eventStore.GetTopExceptionsAsync(
            filterSql, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            limit, cancellationToken);
        return Results.Ok(new { exceptions });
    }

    private static async Task<IResult> SlowOperationsAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null,
        string property = "Elapsed",
        int minSamples = 20,
        double floorMs = 50,
        double factor = 2.0,
        int limit = 20)
    {
        if (property.Length == 0 || !property.All(c => char.IsAsciiLetterOrDigit(c) || c == '_'))
        {
            return BadRequest("Invalid query", "property must contain only letters, digits, or underscores.");
        }
        if (minSamples < 1 || floorMs < 0 || factor < 1)
        {
            return BadRequest("Invalid query", "minSamples>=1, floorMs>=0 and factor>=1 are required.");
        }
        if (!TryValidateCommon(from, to, filter, limit, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }

        var operations = await eventStore.GetSlowOperationsAsync(
            filterSql, BaselineStart, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            property, minSamples, floorMs, factor, limit, cancellationToken);
        return Results.Ok(new { operations });
    }

    private static async Task<IResult> PropertyValuesAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string property,
        string from,
        string to,
        string? filter = null,
        int limit = 20)
    {
        // same alphabet as query-language identifiers; anything else could escape the JSON path
        if (property.Length == 0 || !property.All(c => char.IsAsciiLetterOrDigit(c) || c == '_'))
        {
            return BadRequest("Invalid query", "property must contain only letters, digits, or underscores.");
        }
        if (!TryValidateCommon(from, to, filter, limit, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }

        var values = await eventStore.GetPropertyValuesAsync(
            filterSql, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            property, limit, cancellationToken);
        return Results.Ok(new { values });
    }

    private static bool TryValidateCommon(
        string from, string to, string? filter, int limit,
        out DateTimeOffset fromValue, out DateTimeOffset toValue, out QuerySql? filterSql, out IResult? error)
    {
        filterSql = null;
        error = null;
        if (!TryParseRange(from, to, out fromValue, out toValue, out var rangeError))
        {
            error = BadRequest("Invalid query", rangeError!);
            return false;
        }
        if (limit is < 1 or > 100)
        {
            error = BadRequest("Invalid query", "limit must be between 1 and 100.");
            return false;
        }
        if (!TryTranslateFilter(filter, out filterSql, out var filterError))
        {
            error = BadRequest("Invalid filter", filterError!);
            return false;
        }
        return true;
    }

    private static async Task<IResult> HistogramAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null,
        int buckets = 50)
    {
        if (buckets is < 1 or > 500)
        {
            return BadRequest("Invalid query", "buckets must be between 1 and 500.");
        }
        if (!TryParseRange(from, to, out var fromValue, out var toValue, out var rangeError))
        {
            return BadRequest("Invalid query", rangeError!);
        }
        if (!TryTranslateFilter(filter, out var filterSql, out var filterError))
        {
            return BadRequest("Invalid filter", filterError!);
        }

        var result = await eventStore.GetHistogramAsync(filterSql, fromValue, toValue, buckets, cancellationToken);
        return Results.Ok(new { buckets = result });
    }

    private static async Task<IResult> HeatmapAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null)
    {
        if (!TryParseRange(from, to, out var fromValue, out var toValue, out var rangeError))
        {
            return BadRequest("Invalid query", rangeError!);
        }
        if (!TryTranslateFilter(filter, out var filterSql, out var filterError))
        {
            return BadRequest("Invalid filter", filterError!);
        }

        var cells = await eventStore.GetHeatmapAsync(
            filterSql, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue), cancellationToken);
        return Results.Ok(new { cells });
    }

    private static async Task<IResult> SummaryAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null)
    {
        if (!TryParseRange(from, to, out var fromValue, out var toValue, out var rangeError))
        {
            return BadRequest("Invalid query", rangeError!);
        }
        if (!TryTranslateFilter(filter, out var filterSql, out var filterError))
        {
            return BadRequest("Invalid filter", filterError!);
        }

        var summary = await eventStore.GetSummaryAsync(
            filterSql, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue), cancellationToken);
        return Results.Ok(summary);
    }

    private static bool TryParseRange(
        string from, string to, out DateTimeOffset fromValue, out DateTimeOffset toValue, out string? error)
    {
        toValue = default;
        if (!TimestampParsing.TryParseUtc(from, out fromValue))
        {
            error = "from is not a valid ISO-8601 timestamp.";
            return false;
        }
        if (!TimestampParsing.TryParseUtc(to, out toValue))
        {
            error = "to is not a valid ISO-8601 timestamp.";
            return false;
        }
        if (toValue <= fromValue)
        {
            error = "to must be after from.";
            return false;
        }
        error = null;
        return true;
    }

    private static bool TryTranslateFilter(string? filter, out QuerySql? filterSql, out string? error)
    {
        filterSql = null;
        error = null;
        if (string.IsNullOrWhiteSpace(filter))
        {
            return true;
        }
        try
        {
            filterSql = SqlTranslator.Translate(QueryParser.Parse(filter));
            return true;
        }
        catch (QueryParseException ex)
        {
            error = $"{ex.Message} (position {ex.Position})";
            return false;
        }
    }

    private static IResult BadRequest(string title, string detail) =>
        Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: title, detail: detail);
}
