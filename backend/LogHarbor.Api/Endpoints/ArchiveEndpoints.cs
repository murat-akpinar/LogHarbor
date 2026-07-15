using LogHarbor.Api.Archiving;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class ArchiveEndpoints
{
    public sealed record HydrateRequest(string? From, string? To);

    public sealed record SegmentStatusResponse(string Day, string Status);

    public static void MapArchive(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/archive");

        group.MapGet("/segments", async (IArchiveStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.ListAsync(cancellationToken)));

        group.MapPost("/hydrate", HydrateAsync);

        group.MapGet("/hydrate/status", StatusAsync);
    }

    private static async Task<IResult> HydrateAsync(
        HydrateRequest request,
        IArchiveStore store,
        HydrationQueue queue,
        CancellationToken cancellationToken)
    {
        if (!TryParseDay(request.From, out var fromDay) || fromDay is null)
        {
            return BadRequest("from is required and must be a valid ISO-8601 timestamp.");
        }
        if (!TryParseDay(request.To, out var toDay) || toDay is null)
        {
            return BadRequest("to is required and must be a valid ISO-8601 timestamp.");
        }

        foreach (var segment in await store.ListRangeAsync(fromDay, toDay, cancellationToken))
        {
            // claim atomically: two concurrent hydrate calls must not enqueue the same day twice
            if (segment.Status == SegmentStatus.Cold
                && await store.TryBeginHydrationAsync(segment.Day, cancellationToken))
            {
                queue.Enqueue(segment.Day);
            }
        }

        return Results.Accepted(value: new
        {
            segments = await GetStatusesAsync(store, fromDay, toDay, cancellationToken),
        });
    }

    private static async Task<IResult> StatusAsync(
        IArchiveStore store,
        CancellationToken cancellationToken,
        string? from = null,
        string? to = null)
    {
        if (!TryParseDay(from, out var fromDay))
        {
            return BadRequest("from is not a valid ISO-8601 timestamp.");
        }
        if (!TryParseDay(to, out var toDay))
        {
            return BadRequest("to is not a valid ISO-8601 timestamp.");
        }

        return Results.Ok(new { segments = await GetStatusesAsync(store, fromDay, toDay, cancellationToken) });
    }

    private static async Task<IReadOnlyList<SegmentStatusResponse>> GetStatusesAsync(
        IArchiveStore store, string? fromDay, string? toDay, CancellationToken cancellationToken)
    {
        var segments = await store.ListRangeAsync(fromDay, toDay, cancellationToken);
        return segments.Select(segment => new SegmentStatusResponse(segment.Day, segment.Status)).ToList();
    }

    /// <summary>Bounds arrive as timestamps; segments are whole UTC days, so only the day part matters.</summary>
    private static bool TryParseDay(string? input, out string? day)
    {
        day = null;
        if (string.IsNullOrWhiteSpace(input))
        {
            return true;
        }
        if (!TimestampParsing.TryParseUtc(input, out var parsed))
        {
            return false;
        }
        day = ClefParser.FormatTimestamp(parsed)[..10];
        return true;
    }

    private static IResult BadRequest(string detail) =>
        Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid request", detail: detail);
}
