using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class HealthEndpoints
{
    public static void MapHealth(this WebApplication app)
    {
        app.MapGet("/healthz", (LogHarborDb db) => Results.Ok(new
        {
            status = "ok",
            eventCount = db.CountEvents(),
            dbSizeBytes = db.GetDatabaseSizeBytes(),
        }));
    }
}
