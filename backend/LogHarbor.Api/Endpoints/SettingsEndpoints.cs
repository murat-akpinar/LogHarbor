using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class SettingsEndpoints
{
    public sealed record ArchiveSettingsRequest(int? CompressAfterDays, int? HydrationKeepDays, int? RetentionDays);

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
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            var settings = new ArchiveSettings
            {
                CompressAfterDays = request.CompressAfterDays!.Value,
                HydrationKeepDays = request.HydrationKeepDays!.Value,
                RetentionDays = request.RetentionDays!.Value,
            };
            await store.SaveArchiveSettingsAsync(settings, cancellationToken);
            return Results.Ok(settings);
        });
    }
}
