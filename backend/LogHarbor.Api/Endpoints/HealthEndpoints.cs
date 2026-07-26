using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class HealthEndpoints
{
    public static void MapHealth(this WebApplication app)
    {
        // Answers "can this server still accept logs", not "is the process up". The check used
        // to be two reads and a hardcoded "ok", which stayed green on a full disk while every
        // batch failed with a 500 — measured, and the reason a container runtime never noticed.
        app.MapGet("/healthz", (LogHarborDb db) =>
        {
            var writable = db.CanWrite();
            var payload = new
            {
                status = writable ? "ok" : "degraded",
                writable,
                eventCount = db.CountEvents(),
                dbSizeBytes = db.GetDatabaseSizeBytes(),
                freeDiskBytes = db.GetFreeDiskBytes(),
            };
            // 503 so the Docker healthcheck and any uptime monitor act on it
            return writable
                ? Results.Ok(payload)
                : Results.Json(payload, statusCode: StatusCodes.Status503ServiceUnavailable);
        });
    }
}
