using System.Text;
using System.Text.Json;
using LogHarbor.Api;
using LogHarbor.Api.LiveTail;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;
using LogHarbor.Core.Telemetry;

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

    private const string ClefSource = "clef";
    private const string SeqRawSource = "seq-raw";

    public static void MapIngestion(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/events/raw", HandleAsync).RequireRateLimiting(RateLimitPolicy);
    }

    private static async Task<IResult> HandleAsync(
        HttpRequest request,
        IEventStore eventStore,
        TailBroadcaster tailBroadcaster,
        IngestionOptions options,
        IngestRejectionRecorder rejections,
        CancellationToken cancellationToken)
    {
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        var bytes = await RequestBody.ReadCappedAsync(request, options.MaxBatchBytes, cancellationToken);
        if (bytes is null)
        {
            return await RejectAsync(request, rejections,
                TooLarge($"Batch exceeds MaxBatchBytes ({options.MaxBatchBytes})."), cancellationToken);
        }

        var serverTime = DateTimeOffset.UtcNow;
        // The format is sniffed, not taken from Content-Type: plenty of clients post CLEF as
        // application/json, so the header cannot decide it — but the two bodies are distinct.
        var isSeqRawEvents = SeqRawEventsParser.IsEnvelope(bytes);
        var source = isSeqRawEvents ? SeqRawSource : ClefSource;
        var (events, failure) = isSeqRawEvents
            ? ParseSeqRawEvents(bytes, serverTime, options)
            : ParseClefLines(Encoding.UTF8.GetString(bytes), serverTime, options);
        if (failure is not null)
        {
            return await RejectAsync(request, rejections, failure, cancellationToken);
        }

        var ids = await eventStore.WriteBatchAsync(events, cancellationToken);
        LogHarborMetrics.CountIngested(events.Count, source);
        await tailBroadcaster.BroadcastAsync(ids, cancellationToken);
        LogHarborMetrics.RecordIngestDuration(
            System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMilliseconds, source);
        return Results.StatusCode(StatusCodes.Status201Created);
    }

    /// <summary>A rejected batch: the reason it gets recorded under, the detail the client
    /// and the operator both see, and how to turn that into the response.</summary>
    private sealed record IngestFailure(string Reason, string Detail, Func<string, IResult> ToResult);

    private static IngestFailure TooLarge(string detail) =>
        new(RejectionReasons.TooLarge, detail, PayloadTooLarge);

    private static IngestFailure InvalidPayload(string title, string detail) =>
        new(RejectionReasons.InvalidPayload, detail, d => BadRequest(title, d));

    private static (List<Event> Events, IngestFailure? Failure) ParseClefLines(
        string body, DateTimeOffset serverTime, IngestionOptions options)
    {
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
                return ([], TooLarge(
                    $"line {lineNumber}: event exceeds MaxEventBytes ({options.MaxEventBytes})."));
            }
            if (!ClefParser.TryParse(line, serverTime, out var parsed, out var error))
            {
                return ([], InvalidPayload("Invalid CLEF payload", $"line {lineNumber}: {error}"));
            }
            events.Add(parsed!);
        }
        return (events, null);
    }

    private static (List<Event> Events, IngestFailure? Failure) ParseSeqRawEvents(
        byte[] body, DateTimeOffset serverTime, IngestionOptions options)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(body);
        }
        catch (JsonException)
        {
            return ([], InvalidPayload("Invalid Seq events payload", "invalid JSON"));
        }

        using (document)
        {
            var events = new List<Event>();
            var index = 0;
            foreach (var element in document.RootElement
                         .GetProperty(SeqRawEventsParser.EventsProperty).EnumerateArray())
            {
                index++;
                if (Encoding.UTF8.GetByteCount(element.GetRawText()) > options.MaxEventBytes)
                {
                    return ([], TooLarge(
                        $"event {index}: event exceeds MaxEventBytes ({options.MaxEventBytes})."));
                }
                if (!SeqRawEventsParser.TryParseEvent(element, serverTime, out var parsed, out var error))
                {
                    return ([], InvalidPayload("Invalid Seq events payload", $"event {index}: {error}"));
                }
                events.Add(parsed!);
            }
            return (events, null);
        }
    }

    private static async Task<IResult> RejectAsync(
        HttpRequest request, IngestRejectionRecorder rejections, IngestFailure failure,
        CancellationToken cancellationToken)
    {
        await rejections.RecordAsync(
            IngestRejectionRecorder.ApiKeyIdOf(request.HttpContext),
            failure.Reason, failure.Detail, request.Path, cancellationToken);
        return failure.ToResult(failure.Detail);
    }

    private static IResult BadRequest(string title, string detail) =>
        Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: title, detail: detail);

    private static IResult PayloadTooLarge(string detail) =>
        Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge,
            title: "Payload too large", detail: detail);
}
