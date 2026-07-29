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
        IngestRejectionRecorder rejections,
        CancellationToken cancellationToken)
    {
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        var contentType = httpRequest.ContentType ?? "";
        var isProtobuf = contentType.StartsWith("application/x-protobuf", StringComparison.OrdinalIgnoreCase);
        var isJson = contentType.StartsWith("application/json", StringComparison.OrdinalIgnoreCase);
        if (!isProtobuf && !isJson)
        {
            var detail = "POST /v1/traces accepts application/x-protobuf or application/json.";
            await rejections.RecordAsync(httpRequest.HttpContext,
                RejectionReasons.UnsupportedMediaType, detail, cancellationToken);
            return Results.Problem(statusCode: StatusCodes.Status415UnsupportedMediaType,
                title: "Unsupported content type", detail: detail);
        }

        var body = await RequestBody.ReadCappedAsync(httpRequest, options.MaxBatchBytes, cancellationToken);
        if (body is null)
        {
            var detail = $"Batch exceeds MaxBatchBytes ({options.MaxBatchBytes}).";
            await rejections.RecordAsync(httpRequest.HttpContext,
                RejectionReasons.TooLarge, detail, cancellationToken);
            return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge,
                title: "Payload too large", detail: detail);
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
                return await RejectInvalidAsync(httpRequest, rejections, ex.Message, cancellationToken);
            }
        }
        else
        {
            if (!OtlpJson.TryParseTraces(Encoding.UTF8.GetString(body), out var parsed, out var error))
            {
                return await RejectInvalidAsync(httpRequest, rejections, error!, cancellationToken);
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
            // as on /v1/logs: partial_success inside a 200 is silent unless it is recorded
            await rejections.RecordAsync(httpRequest.HttpContext,
                RejectionReasons.InvalidPayload,
                $"{result.RejectedSpans} span(s) dropped: {result.ErrorMessage}",
                cancellationToken);
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

    private static async Task<IResult> RejectInvalidAsync(
        HttpRequest httpRequest, IngestRejectionRecorder rejections, string detail,
        CancellationToken cancellationToken)
    {
        await rejections.RecordAsync(httpRequest.HttpContext,
            RejectionReasons.InvalidPayload, detail, cancellationToken);
        return Problems.BadRequest("Invalid OTLP payload", detail);
    }
}
