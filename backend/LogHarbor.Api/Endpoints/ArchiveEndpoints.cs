using LogHarbor.Api.Archiving;
using LogHarbor.Core.Archiving;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class ArchiveEndpoints
{
    /// <summary>About a month of days per extraction request (see HydrateAsync).</summary>
    private const int MaxSegmentsPerRequest = 31;

    public sealed record HydrateRequest(string? From, string? To);

    public sealed record SegmentStatusResponse(string Day, string Status);

    /// <summary>A segment plus whether its file is actually on disk. The row and the file are
    /// separate things — a database restored without its archive directory lists days it can
    /// no longer produce, and without this the UI would keep advertising them as available.</summary>
    public sealed record SegmentResponse(
        string Day,
        string FilePath,
        long EventCount,
        long SizeBytes,
        long UncompressedBytes,
        string Status,
        string? HydratedAt,
        string? LastAccessedAt,
        bool FileMissing)
    {
        public static SegmentResponse From(ArchiveSegment segment, bool fileMissing) =>
            new(segment.Day, segment.FilePath, segment.EventCount, segment.SizeBytes,
                segment.UncompressedBytes, segment.Status, segment.HydratedAt,
                segment.LastAccessedAt, fileMissing);
    }

    public static void MapArchive(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/archive");

        group.MapGet("/segments", async (
            IArchiveStore store, Archiver archiver, CancellationToken cancellationToken) =>
        {
            var segments = await store.ListAsync(cancellationToken);
            return Results.Ok(segments.Select(segment => SegmentResponse.From(
                segment, fileMissing: !File.Exists(archiver.SegmentPathOf(segment.FilePath)))));
        });

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
            return Problems.BadRequest("Invalid request", "from is required and must be a valid ISO-8601 timestamp.");
        }
        if (!TryParseDay(request.To, out var toDay) || toDay is null)
        {
            return Problems.BadRequest("Invalid request", "to is required and must be a valid ISO-8601 timestamp.");
        }

        var inRange = await store.ListRangeAsync(fromDay, toDay, cancellationToken);
        var cold = inRange.Count(segment => segment.Status == SegmentStatus.Cold);
        // one request must not be able to decompress the whole archive back into SQLite: every
        // hydrated day is real rows on the single writer, and eviction cannot reclaim them for
        // at least HydrationKeepDays
        if (cold > MaxSegmentsPerRequest)
        {
            return Problems.BadRequest("Invalid request", 
                $"That range holds {cold} archived days; at most {MaxSegmentsPerRequest} can be " +
                "extracted per request. Narrow the range and repeat.");
        }

        foreach (var segment in inRange)
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
            return Problems.BadRequest("Invalid request", "from is not a valid ISO-8601 timestamp.");
        }
        if (!TryParseDay(to, out var toDay))
        {
            return Problems.BadRequest("Invalid request", "to is not a valid ISO-8601 timestamp.");
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
}
