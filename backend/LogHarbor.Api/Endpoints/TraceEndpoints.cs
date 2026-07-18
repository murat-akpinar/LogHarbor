using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

/// <summary>Trace-scoped span read for the waterfall (docs/api.md TRACES). Session-gated,
/// read-only; unknown ids return an empty list rather than 404.</summary>
public static class TraceEndpoints
{
    public static void MapTraces(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/traces/{traceId}", async (
            string traceId, ISpanStore spanStore, CancellationToken cancellationToken) =>
        {
            var spans = await spanStore.GetTraceAsync(traceId, cancellationToken);
            return Results.Ok(new { spans });
        });
    }
}
