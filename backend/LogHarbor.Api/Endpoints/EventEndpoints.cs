using LogHarbor.Core.Events;
using LogHarbor.Core.Query;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public sealed record ValidateRequest(string? Filter);

public static class EventEndpoints
{
    public static void MapEvents(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/events", QueryAsync);
        app.MapGet("/api/events/{id:long}", FindAsync);
        app.MapPost("/api/query/validate", Validate);
    }

    private static async Task<IResult> QueryAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string? filter = null,
        string? from = null,
        string? to = null,
        int count = 100,
        long? afterId = null)
    {
        if (count is < 1 or > 1000)
        {
            return Problems.BadRequest("Invalid query", "count must be between 1 and 1000.");
        }
        if (!Timestamps.TryNormalize(from, out var fromUtc))
        {
            return Problems.BadRequest("Invalid query", "from is not a valid ISO-8601 timestamp.");
        }
        if (!Timestamps.TryNormalize(to, out var toUtc))
        {
            return Problems.BadRequest("Invalid query", "to is not a valid ISO-8601 timestamp.");
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
                return Problems.BadRequest("Invalid filter", $"{ex.Message} (position {ex.Position})");
            }
        }

        var page = await eventStore.QueryAsync(
            new EventQuery(filterSql, fromUtc, toUtc, afterId, count), cancellationToken);
        return Results.Ok(page);
    }

    private static async Task<IResult> FindAsync(long id, IEventStore eventStore, CancellationToken cancellationToken)
    {
        var found = await eventStore.FindAsync(id, cancellationToken);
        return found is not null
            ? Results.Ok(found)
            : Problems.NotFound("Event not found");
    }

    private static IResult Validate(ValidateRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Filter))
        {
            return Results.Ok(new { valid = true });
        }
        try
        {
            SqlTranslator.Translate(QueryParser.Parse(request.Filter));
            return Results.Ok(new { valid = true });
        }
        catch (QueryParseException ex)
        {
            return Results.Ok(new { valid = false, error = ex.Message, position = ex.Position });
        }
    }

}
