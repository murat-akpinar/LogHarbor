using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class HealthEndpoints
{
    /// <summary>How recently a failed write still counts against health. Long enough that a
    /// transient full disk does not flap the container between healthy and not, short enough
    /// that a fixed one recovers without a restart.</summary>
    public static readonly TimeSpan WriteFailureWindow = TimeSpan.FromMinutes(5);

    public static void MapHealth(this WebApplication app)
    {
        // Answers "can this server still store logs", not "is the process up". The original
        // check was two reads and a hardcoded "ok", which stayed green on a full disk while
        // every batch failed with a 500.
        //
        // Two signals, because neither is enough alone. A write probe catches a read-only
        // mount or lost permissions, but it is one small row: on a full disk SQLite still
        // fits it in a free page, so the probe passed while 2000-event batches failed —
        // measured. Recorded write failures are the ground truth the probe cannot reach:
        // not a guess about the next write, but a write that already did not happen.
        app.MapGet("/healthz", async (
            LogHarborDb db, IIngestRejectionStore rejections, IngestionOptions options,
            CancellationToken cancellationToken) =>
        {
            var writable = db.CanWrite();
            var lastWriteFailure =
                await rejections.GetLastSeenAsync(RejectionReasons.WriteFailed, cancellationToken);
            var failingNow = IsWithinWindow(lastWriteFailure, DateTimeOffset.UtcNow);
            var freeDiskBytes = db.GetFreeDiskBytes();
            // Without this, a server whose disk filled while nobody happened to be sending
            // would report ok: the probe's one row still fits, and the last real failure ages
            // out of the window. MaxBatchBytes is the honest threshold — below it the next
            // full-size batch cannot land, whether or not one has been tried yet.
            var roomForABatch = freeDiskBytes is null || freeDiskBytes >= options.MaxBatchBytes;
            var healthy = writable && !failingNow && roomForABatch;

            var payload = new
            {
                status = healthy ? "ok" : "degraded",
                writable,
                roomForABatch,
                lastWriteFailure,
                eventCount = db.CountEvents(),
                dbSizeBytes = db.GetDatabaseSizeBytes(),
                freeDiskBytes,
            };
            // 503 so the Docker healthcheck (curl -f) and any uptime monitor act on it
            return healthy
                ? Results.Ok(payload)
                : Results.Json(payload, statusCode: StatusCodes.Status503ServiceUnavailable);
        });
    }

    private static bool IsWithinWindow(string? timestamp, DateTimeOffset now) =>
        timestamp is not null
        && TimestampParsing.TryParseUtc(timestamp, out var parsed)
        && now - parsed < WriteFailureWindow;
}
