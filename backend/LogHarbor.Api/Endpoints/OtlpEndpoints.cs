using System.Text;
using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Logs.V1;
using LogHarbor.Api.LiveTail;
using LogHarbor.Core.Events.Otlp;
using LogHarbor.Core.Storage;
using LogHarbor.Core.Telemetry;

namespace LogHarbor.Api.Endpoints;

/// <summary>
/// OTLP/HTTP log ingestion (docs/ingestion-otlp.md). Standard /v1/logs path, both protobuf
/// and JSON encodings, so OTEL_EXPORTER_OTLP_ENDPOINT pointed at LogHarbor just works.
/// Rides the same pipeline as CLEF: API key gate, rate limit, WriteBatch, tail broadcast.
/// </summary>
public static class OtlpEndpoints
{
    public static void MapOtlp(this IEndpointRouteBuilder app)
    {
        app.MapPost("/v1/logs", HandleLogsAsync).RequireRateLimiting(IngestionEndpoints.RateLimitPolicy);
    }

    private static async Task<IResult> HandleLogsAsync(
        HttpRequest httpRequest,
        IEventStore eventStore,
        TailBroadcaster tailBroadcaster,
        IngestionOptions options,
        CancellationToken cancellationToken)
    {
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        var contentType = httpRequest.ContentType ?? "";
        var isProtobuf = contentType.StartsWith("application/x-protobuf", StringComparison.OrdinalIgnoreCase);
        var isJson = contentType.StartsWith("application/json", StringComparison.OrdinalIgnoreCase);
        if (!isProtobuf && !isJson)
        {
            return Results.Problem(statusCode: StatusCodes.Status415UnsupportedMediaType,
                title: "Unsupported content type",
                detail: "POST /v1/logs accepts application/x-protobuf or application/json.");
        }

        var body = await RequestBody.ReadCappedAsync(httpRequest, options.MaxBatchBytes, cancellationToken);
        if (body is null)
        {
            return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge,
                title: "Payload too large",
                detail: $"Batch exceeds MaxBatchBytes ({options.MaxBatchBytes}).");
        }

        ExportLogsServiceRequest request;
        if (isProtobuf)
        {
            try
            {
                request = ExportLogsServiceRequest.Parser.ParseFrom(body);
            }
            catch (InvalidProtocolBufferException ex)
            {
                return BadRequest(ex.Message);
            }
        }
        else
        {
            if (!OtlpJson.TryParse(Encoding.UTF8.GetString(body), out var parsed, out var error))
            {
                return BadRequest(error!);
            }
            request = parsed!;
        }

        var result = OtlpLogParser.Parse(request, DateTimeOffset.UtcNow, options.MaxEventBytes);
        var ids = await eventStore.WriteBatchAsync(result.Events, cancellationToken);
        LogHarborMetrics.CountIngested(result.Events.Count, "otlp");
        await tailBroadcaster.BroadcastAsync(ids, cancellationToken);
        LogHarborMetrics.RecordIngestDuration(
            System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMilliseconds, "otlp");

        var response = new ExportLogsServiceResponse();
        if (result.RejectedLogRecords > 0)
        {
            response.PartialSuccess = new ExportLogsPartialSuccess
            {
                RejectedLogRecords = result.RejectedLogRecords,
                ErrorMessage = result.ErrorMessage ?? "",
            };
        }
        // the response mirrors the request's encoding, per the OTLP/HTTP spec
        return isProtobuf
            ? Results.Bytes(response.ToByteArray(), "application/x-protobuf")
            : Results.Text(JsonFormatter.Default.Format(response), "application/json");
    }

    private static IResult BadRequest(string detail) =>
        Results.Problem(statusCode: StatusCodes.Status400BadRequest,
            title: "Invalid OTLP payload", detail: detail);
}
