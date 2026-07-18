using System.Text;
using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Trace.V1;
using LogHarbor.Core.Events.Otlp;
using LogHarbor.Core.Storage;
using LogHarbor.Core.Telemetry;

namespace LogHarbor.Api.Endpoints;

/// <summary>
/// OTLP/HTTP trace ingestion (docs/ingestion-otlp.md). Standard /v1/traces path, protobuf and
/// JSON, so OTEL_EXPORTER_OTLP_ENDPOINT pointed at LogHarbor exports spans too. Same API-key
/// gate and rate limit as logs; spans are not broadcast to live tail (a log-only feature).
/// </summary>
public static class OtlpTraceEndpoints
{
    public static void MapOtlpTraces(this IEndpointRouteBuilder app)
    {
        app.MapPost("/v1/traces", HandleAsync).RequireRateLimiting(IngestionEndpoints.RateLimitPolicy);
    }

    private static async Task<IResult> HandleAsync(
        HttpRequest httpRequest,
        ISpanStore spanStore,
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
                detail: "POST /v1/traces accepts application/x-protobuf or application/json.");
        }

        var body = await RequestBody.ReadCappedAsync(httpRequest, options.MaxBatchBytes, cancellationToken);
        if (body is null)
        {
            return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge,
                title: "Payload too large",
                detail: $"Batch exceeds MaxBatchBytes ({options.MaxBatchBytes}).");
        }

        ExportTraceServiceRequest request;
        if (isProtobuf)
        {
            try
            {
                request = ExportTraceServiceRequest.Parser.ParseFrom(body);
            }
            catch (InvalidProtocolBufferException ex)
            {
                return BadRequest(ex.Message);
            }
        }
        else
        {
            if (!OtlpJson.TryParseTraces(Encoding.UTF8.GetString(body), out var parsed, out var error))
            {
                return BadRequest(error!);
            }
            request = parsed!;
        }

        var result = OtlpTraceParser.Parse(request, DateTimeOffset.UtcNow, options.MaxEventBytes);
        await spanStore.WriteBatchAsync(result.Spans, cancellationToken);
        LogHarborMetrics.RecordIngestDuration(
            System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMilliseconds, "traces");

        var response = new ExportTraceServiceResponse();
        if (result.RejectedSpans > 0)
        {
            response.PartialSuccess = new ExportTracePartialSuccess
            {
                RejectedSpans = result.RejectedSpans,
                ErrorMessage = result.ErrorMessage ?? "",
            };
        }
        return isProtobuf
            ? Results.Bytes(response.ToByteArray(), "application/x-protobuf")
            : Results.Text(JsonFormatter.Default.Format(response), "application/json");
    }

    private static IResult BadRequest(string detail) =>
        Results.Problem(statusCode: StatusCodes.Status400BadRequest,
            title: "Invalid OTLP payload", detail: detail);
}
