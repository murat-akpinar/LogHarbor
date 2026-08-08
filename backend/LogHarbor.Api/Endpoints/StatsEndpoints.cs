using LogHarbor.Core.Analysis;
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
        group.MapGet("/latency", LatencyAsync);
        group.MapGet("/heatmap", HeatmapAsync);
        group.MapGet("/summary", SummaryAsync);
        group.MapGet("/ingestion-lag", IngestionLagAsync);
        group.MapGet("/ingest-rejections", IngestRejectionsAsync);
        group.MapGet("/top-errors", TopErrorsAsync);
        group.MapGet("/top-exceptions", TopExceptionsAsync);
        group.MapGet("/slow-operations", SlowOperationsAsync);
        group.MapGet("/property-values", PropertyValuesAsync);
        group.MapGet("/services", ServicesAsync);
        group.MapGet("/service-status", ServiceStatusAsync);
        group.MapGet("/operations", OperationsAsync);
        group.MapGet("/user-activity", UserActivityAsync);
        group.MapGet("/queries", QueriesAsync);
        group.MapGet("/findings", FindingsAsync);
    }

    /// <summary>
    /// What the server noticed by itself in this range: no rule, no threshold, nothing to set up.
    /// It lives under /stats because that is what it is — a derived read over the same range and
    /// the same validation as every row on the analysis pages. Nothing is stored and nothing is
    /// pushed; a finding is a shortlist entry, never an alarm.
    /// </summary>
    private static async Task<IResult> FindingsAsync(
        FindingScanner scanner,
        CancellationToken cancellationToken,
        string from,
        string to,
        string routeProperty = "Path",
        string methodProperty = "Method")
    {
        foreach (var name in new[] { routeProperty, methodProperty })
        {
            if (name.Length == 0 || !name.All(c => char.IsAsciiLetterOrDigit(c) || c == '_' || c == '.'))
            {
                return Problems.BadRequest(
                    "Invalid query", "property names must contain only letters, digits, underscores, or dots.");
            }
        }
        if (!TryParseRange(from, to, out var fromValue, out var toValue, out var rangeError))
        {
            return Problems.BadRequest("Invalid query", rangeError!);
        }

        var findings = await scanner.ScanAsync(
            fromValue, toValue, routeProperty, methodProperty, cancellationToken);
        return Results.Ok(new { findings });
    }

    private static readonly string[] DefaultErrorLevels = ["Error", "Fatal"];

    /// <summary>Ingestion requests that were turned away, by key and reason. The one view that
    /// answers "a client swears it is sending logs and nothing arrives" (docs/api.md).</summary>
    private static async Task<IResult> IngestRejectionsAsync(
        IIngestRejectionStore rejectionStore,
        CancellationToken cancellationToken,
        int days = 7)
    {
        if (days is < 1 or > SqliteIngestRejectionStore.DefaultKeepDays)
        {
            return Problems.BadRequest("Invalid query",
                $"days must be between 1 and {SqliteIngestRejectionStore.DefaultKeepDays}.");
        }

        var rejections = await rejectionStore.ListAsync(days, cancellationToken);
        return Results.Ok(new
        {
            rejections,
            totalRequests = rejections.Sum(rejection => rejection.RequestCount),
        });
    }

    // events before this predate the server; used as the open-ended baseline start for slow-operations
    private const string BaselineStart = "2000-01-01T00:00:00.0000000Z";

    // widest trend strip any page draws is 24 columns in a table cell; the ceiling leaves room to
    // grow one without being an invitation to ask for a thousand
    private const int MaxTrendBuckets = 120;

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
            return Problems.BadRequest("Invalid query", $"unknown level '{unknown}'.");
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
        if (property.Length == 0 || !property.All(c => char.IsAsciiLetterOrDigit(c) || c == '_' || c == '.'))
        {
            return Problems.BadRequest("Invalid query", "property must contain only letters, digits, underscores, or dots.");
        }
        if (minSamples < 1 || floorMs < 0 || factor < 1)
        {
            return Problems.BadRequest("Invalid query", "minSamples>=1, floorMs>=0 and factor>=1 are required.");
        }
        if (!TryValidateCommon(from, to, filter, limit, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }

        var result = await eventStore.GetSlowOperationsAsync(
            filterSql, BaselineStart, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            property, minSamples, floorMs, factor, limit, cancellationToken);
        return Results.Ok(result);
    }

    private static async Task<IResult> ServicesAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null,
        int limit = 50)
    {
        if (!TryValidateCommon(from, to, filter, limit, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }

        var services = await eventStore.GetServiceOverviewAsync(
            filterSql, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            limit, cancellationToken);
        return Results.Ok(new { services });
    }

    private static async Task<IResult> ServiceStatusAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null,
        string source = "service-probe",
        int staleMinutes = 5,
        int limit = 100)
    {
        // the probe cycle is a minute, so the default tolerates four missed heartbeats
        if (staleMinutes is < 1 or > 1440)
        {
            return Problems.BadRequest("Invalid query", "staleMinutes must be between 1 and 1440.");
        }
        if (!TryValidateCommon(from, to, filter, limit, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }

        var readings = await eventStore.GetServiceStatusAsync(
            filterSql, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            source, limit, cancellationToken);
        // judged against the end of the range, not wall-clock now, so a historical range reads as
        // how things stood then (docs/service-status.md)
        var services = ServiceStatus.Evaluate(readings, toValue, staleMinutes);
        return Results.Ok(new { staleMinutes, asOf = ClefParser.FormatTimestamp(toValue), services });
    }

    private static async Task<IResult> OperationsAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null,
        string routeProperty = "Path",
        string methodProperty = "Method",
        string statusProperty = "StatusCode",
        int limit = 50,
        int trendBuckets = 0)
    {
        if (!TryValidateCommon(from, to, filter, limit, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }
        // sinks disagree on the spelling (Path, RequestPath, http.route), so all three are settings
        foreach (var name in new[] { routeProperty, methodProperty, statusProperty })
        {
            if (name.Length == 0 || !name.All(c => char.IsAsciiLetterOrDigit(c) || c == '_' || c == '.'))
            {
                return Problems.BadRequest("Invalid query",
                    "property names must contain only letters, digits, underscores, or dots.");
            }
        }
        // a caller that wants no strips pays for none; the ceiling is the widest strip any page
        // draws, and asking for more columns than that only makes the response bigger
        if (trendBuckets < 0 || trendBuckets > MaxTrendBuckets)
        {
            return Problems.BadRequest("Invalid query",
                $"trendBuckets must be between 0 and {MaxTrendBuckets}.");
        }

        var operations = await eventStore.GetOperationOverviewAsync(
            filterSql, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            routeProperty, methodProperty, statusProperty, limit, trendBuckets, cancellationToken);
        return Results.Ok(new { operations });
    }

    private static async Task<IResult> UserActivityAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null,
        string property = "UserId",
        int limit = 50,
        int trendBuckets = 0)
    {
        // same alphabet as query-language identifiers; anything else could escape the JSON path
        if (property.Length == 0 || !property.All(c => char.IsAsciiLetterOrDigit(c) || c == '_' || c == '.'))
        {
            return Problems.BadRequest("Invalid query", "property must contain only letters, digits, underscores, or dots.");
        }
        if (!TryValidateCommon(from, to, filter, limit, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }
        if (trendBuckets < 0 || trendBuckets > MaxTrendBuckets)
        {
            return Problems.BadRequest("Invalid query",
                $"trendBuckets must be between 0 and {MaxTrendBuckets}.");
        }

        var users = await eventStore.GetUserActivityAsync(
            filterSql, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            property, limit, trendBuckets, cancellationToken);
        return Results.Ok(new { users });
    }

    private static async Task<IResult> QueriesAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null,
        string property = "commandText",
        string durationProperty = "elapsed",
        string connectionProperty = "connection",
        int limit = 50)
    {
        // same alphabet as query-language identifiers; anything else could escape the JSON path
        foreach (var name in new[] { property, durationProperty, connectionProperty })
        {
            if (name.Length == 0 || !name.All(c => char.IsAsciiLetterOrDigit(c) || c == '_' || c == '.'))
            {
                return Problems.BadRequest("Invalid query", "property names must contain only letters, digits, underscores, or dots.");
            }
        }
        if (!TryValidateCommon(from, to, filter, limit, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }

        var queries = await eventStore.GetQueryOverviewAsync(
            filterSql, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            property, durationProperty, connectionProperty, limit, cancellationToken);
        return Results.Ok(new { queries });
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
        if (property.Length == 0 || !property.All(c => char.IsAsciiLetterOrDigit(c) || c == '_' || c == '.'))
        {
            return Problems.BadRequest("Invalid query", "property must contain only letters, digits, underscores, or dots.");
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

    /// <summary>Range + filter, which every stats endpoint takes.</summary>
    private static bool TryValidateRange(
        string from, string to, string? filter,
        out DateTimeOffset fromValue, out DateTimeOffset toValue, out QuerySql? filterSql, out IResult? error)
    {
        filterSql = null;
        error = null;
        if (!TryParseRange(from, to, out fromValue, out toValue, out var rangeError))
        {
            error = Problems.BadRequest("Invalid query", rangeError!);
            return false;
        }
        if (!TryTranslateFilter(filter, out filterSql, out var filterError))
        {
            error = Problems.BadRequest("Invalid filter", filterError!);
            return false;
        }
        return true;
    }

    /// <summary>The above plus the row limit, for the nine endpoints that page their results.</summary>
    private static bool TryValidateCommon(
        string from, string to, string? filter, int limit,
        out DateTimeOffset fromValue, out DateTimeOffset toValue, out QuerySql? filterSql, out IResult? error)
    {
        if (!TryValidateRange(from, to, filter, out fromValue, out toValue, out filterSql, out error))
        {
            return false;
        }
        if (limit is < 1 or > 100)
        {
            error = Problems.BadRequest("Invalid query", "limit must be between 1 and 100.");
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
            return Problems.BadRequest("Invalid query", "buckets must be between 1 and 500.");
        }
        if (!TryValidateRange(from, to, filter, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }

        var result = await eventStore.GetHistogramAsync(filterSql, fromValue, toValue, buckets, cancellationToken);
        return Results.Ok(new { buckets = result });
    }

    private static async Task<IResult> LatencyAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null,
        int buckets = 50)
    {
        if (buckets is < 1 or > 500)
        {
            return Problems.BadRequest("Invalid query", "buckets must be between 1 and 500.");
        }
        if (!TryValidateRange(from, to, filter, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }

        var result = await eventStore.GetLatencyAsync(filterSql, fromValue, toValue, buckets, cancellationToken);
        return Results.Ok(result);
    }

    private static async Task<IResult> HeatmapAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null)
    {
        if (!TryValidateRange(from, to, filter, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }

        var cells = await eventStore.GetHeatmapAsync(
            filterSql, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue), cancellationToken);
        return Results.Ok(new { cells });
    }

    /// <summary>How late events in the range arrived relative to their own timestamps.</summary>
    private static async Task<IResult> IngestionLagAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null,
        double lateAfterSeconds = 60)
    {
        // a negative threshold would count clock-skewed events as late, which is the one thing
        // this endpoint separates out; an unbounded one makes "late" meaningless
        if (lateAfterSeconds is < 0 or > 86400)
        {
            return Problems.BadRequest("Invalid query", "lateAfterSeconds must be between 0 and 86400.");
        }
        if (!TryValidateRange(from, to, filter, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }

        var lag = await eventStore.GetIngestionLagAsync(
            filterSql, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            lateAfterSeconds, cancellationToken);
        return Results.Ok(new { lateAfterSeconds, lag });
    }

    private static async Task<IResult> SummaryAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null)
    {
        if (!TryValidateRange(from, to, filter, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
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
}
