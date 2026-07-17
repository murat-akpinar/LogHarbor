using System.Text;
using LogHarbor.Api.LiveTail;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

/// <summary>Ingestion limits, bound from the LogHarbor configuration section.</summary>
public sealed record IngestionOptions
{
    public int MaxBatchBytes { get; init; } = 5 * 1024 * 1024;
    public int MaxEventBytes { get; init; } = 256 * 1024;
    public int IngestRateLimitPerMinute { get; init; } = 1200;
    public int LoginRateLimitPerMinute { get; init; } = 10;
}

public static class IngestionEndpoints
{
    public const string RateLimitPolicy = "ingestion";

    public static void MapIngestion(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/events/raw", HandleAsync).RequireRateLimiting(RateLimitPolicy);
    }

    private static async Task<IResult> HandleAsync(
        HttpRequest request,
        IEventStore eventStore,
        TailBroadcaster tailBroadcaster,
        IngestionOptions options,
        CancellationToken cancellationToken)
    {
        var bytes = await RequestBody.ReadCappedAsync(request, options.MaxBatchBytes, cancellationToken);
        if (bytes is null)
        {
            return PayloadTooLarge($"Batch exceeds MaxBatchBytes ({options.MaxBatchBytes}).");
        }
        var body = Encoding.UTF8.GetString(bytes);

        var serverTime = DateTimeOffset.UtcNow;
        var events = new List<Event>();
        var lineNumber = 0;
        foreach (var rawLine in body.Split('\n'))
        {
            lineNumber++;
            var line = rawLine.TrimEnd('\r');
            if (line.Length == 0)
            {
                continue;
            }
            if (Encoding.UTF8.GetByteCount(line) > options.MaxEventBytes)
            {
                return PayloadTooLarge($"line {lineNumber}: event exceeds MaxEventBytes ({options.MaxEventBytes}).");
            }
            if (!ClefParser.TryParse(line, serverTime, out var parsed, out var error))
            {
                return Results.Problem(statusCode: StatusCodes.Status400BadRequest,
                    title: "Invalid CLEF payload", detail: $"line {lineNumber}: {error}");
            }
            events.Add(parsed!);
        }

        var ids = await eventStore.WriteBatchAsync(events, cancellationToken);
        await tailBroadcaster.BroadcastAsync(ids, cancellationToken);
        return Results.StatusCode(StatusCodes.Status201Created);
    }

    private static IResult PayloadTooLarge(string detail) =>
        Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge,
            title: "Payload too large", detail: detail);
}
