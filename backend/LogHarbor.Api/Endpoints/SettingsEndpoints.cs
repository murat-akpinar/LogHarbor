using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class SettingsEndpoints
{
    public sealed record ArchiveSettingsRequest(
        int? CompressAfterDays, int? HydrationKeepDays, int? RetentionDays, long? MaxDatabaseBytes);

    /// <summary>Below this a cap would fight the ingestion limits rather than protect the disk:
    /// one MaxBatchBytes batch has to fit with room to spare.</summary>
    public const long MinimumSizeCapBytes = 64 * 1024 * 1024;

    public static void MapSettings(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/settings");

        group.MapGet("/archive", async (ISettingsStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.GetArchiveSettingsAsync(cancellationToken)));

        group.MapPut("/archive", async (
            ArchiveSettingsRequest request, ISettingsStore store, CancellationToken cancellationToken) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (request.CompressAfterDays is not >= 0)
            {
                errors["compressAfterDays"] = ["Must be 0 (disabled) or a positive number of days."];
            }
            if (request.HydrationKeepDays is not >= 1)
            {
                errors["hydrationKeepDays"] = ["Must be at least 1 day."];
            }
            if (request.RetentionDays is not >= 1)
            {
                errors["retentionDays"] = ["Must be at least 1 day."];
            }
            // retention shorter than the compression delay means every day is archived to a file
            // and deleted again on the same pass — the compression work is pure waste, and the
            // setting reads as if it keeps data longer than it does
            if (errors.Count == 0 && request.CompressAfterDays > 0
                && request.RetentionDays < request.CompressAfterDays)
            {
                errors["retentionDays"] = [
                    $"Must be at least the compression delay ({request.CompressAfterDays} days), " +
                    "otherwise days would be compressed and deleted on the same pass."];
            }
            // Omitted means "leave it alone", not "disable it": the field arrived after the
            // other three, and a client that does not know about it must not silently switch
            // off a ceiling someone set deliberately.
            if (request.MaxDatabaseBytes is < 0)
            {
                errors["maxDatabaseBytes"] = ["Must be 0 (disabled) or a positive size in bytes."];
            }
            // a tiny but non-zero cap would delete history on every pass and still never fit,
            // so refuse it rather than let it quietly shred the data
            else if (request.MaxDatabaseBytes is > 0 and < MinimumSizeCapBytes)
            {
                errors["maxDatabaseBytes"] = [
                    $"Must be 0 (disabled) or at least {MinimumSizeCapBytes / (1024 * 1024)} MB."];
            }
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            var current = await store.GetArchiveSettingsAsync(cancellationToken);
            var settings = new ArchiveSettings
            {
                CompressAfterDays = request.CompressAfterDays!.Value,
                HydrationKeepDays = request.HydrationKeepDays!.Value,
                RetentionDays = request.RetentionDays!.Value,
                MaxDatabaseBytes = request.MaxDatabaseBytes ?? current.MaxDatabaseBytes,
            };
            await store.SaveArchiveSettingsAsync(settings, cancellationToken);
            return Results.Ok(settings);
        });
    }
}
