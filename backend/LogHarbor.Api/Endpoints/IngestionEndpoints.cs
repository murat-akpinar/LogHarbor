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
        if (request.ContentLength > options.MaxBatchBytes)
        {
            return PayloadTooLarge($"Batch exceeds MaxBatchBytes ({options.MaxBatchBytes}).");
        }

        var body = await ReadBodyCappedAsync(request.Body, options.MaxBatchBytes, cancellationToken);
        if (body is null)
        {
            return PayloadTooLarge($"Batch exceeds MaxBatchBytes ({options.MaxBatchBytes}).");
        }

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

    /// <summary>Reads at most maxBytes; returns null when the body is larger (chunked bodies have no Content-Length).</summary>
    private static async Task<string?> ReadBodyCappedAsync(Stream body, int maxBytes, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        int read;
        while ((read = await body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > maxBytes)
            {
                return null;
            }
        }
        return Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);
    }
}
