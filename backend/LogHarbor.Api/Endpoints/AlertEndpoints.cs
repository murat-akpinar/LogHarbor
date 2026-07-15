using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class AlertEndpoints
{
    private const int MaxWindowMinutes = 7 * 24 * 60;

    public sealed record AlertRequest(
        string? Title, long? SignalId, int? ThresholdCount, int? WindowMinutes, string? WebhookUrl, bool? IsEnabled);

    public static void MapAlerts(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/alerts");

        group.MapGet("/", async (IAlertStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.ListAsync(cancellationToken)));

        group.MapPost("/", async (AlertRequest request, IAlertStore store, CancellationToken cancellationToken) =>
        {
            var validationError = Validate(request);
            if (validationError is not null)
            {
                return validationError;
            }
            try
            {
                var created = await store.CreateAsync(
                    request.Title!.Trim(), request.SignalId!.Value, request.ThresholdCount!.Value,
                    request.WindowMinutes!.Value, request.WebhookUrl!, request.IsEnabled ?? true, cancellationToken);
                return Results.Created($"/api/alerts/{created.Id}", created);
            }
            catch (DuplicateAlertTitleException ex)
            {
                return BadRequest("Duplicate title", ex.Message);
            }
            catch (UnknownSignalException ex)
            {
                return BadRequest("Unknown signal", ex.Message);
            }
        });

        group.MapPut("/{id:long}", async (
            long id, AlertRequest request, IAlertStore store, CancellationToken cancellationToken) =>
        {
            var validationError = Validate(request);
            if (validationError is not null)
            {
                return validationError;
            }
            try
            {
                var updated = await store.UpdateAsync(
                    id, request.Title!.Trim(), request.SignalId!.Value, request.ThresholdCount!.Value,
                    request.WindowMinutes!.Value, request.WebhookUrl!, request.IsEnabled ?? true, cancellationToken);
                return updated is not null
                    ? Results.Ok(updated)
                    : Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Alert rule not found");
            }
            catch (DuplicateAlertTitleException ex)
            {
                return BadRequest("Duplicate title", ex.Message);
            }
            catch (UnknownSignalException ex)
            {
                return BadRequest("Unknown signal", ex.Message);
            }
        });

        group.MapDelete("/{id:long}", async (long id, IAlertStore store, CancellationToken cancellationToken) =>
            await store.DeleteAsync(id, cancellationToken)
                ? Results.NoContent()
                : Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Alert rule not found"));
    }

    private static IResult? Validate(AlertRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(request.Title))
        {
            errors["title"] = ["Title is required."];
        }
        if (request.SignalId is null)
        {
            errors["signalId"] = ["Signal is required."];
        }
        if (request.ThresholdCount is not >= 1)
        {
            errors["thresholdCount"] = ["Must be at least 1."];
        }
        if (request.WindowMinutes is not (>= 1 and <= MaxWindowMinutes))
        {
            errors["windowMinutes"] = [$"Must be between 1 and {MaxWindowMinutes} minutes."];
        }
        // http(s) only: a webhook target must never be a file path or another local scheme
        if (!Uri.TryCreate(request.WebhookUrl, UriKind.Absolute, out var url)
            || (url.Scheme != Uri.UriSchemeHttp && url.Scheme != Uri.UriSchemeHttps))
        {
            errors["webhookUrl"] = ["Must be an absolute http(s) URL."];
        }
        return errors.Count > 0 ? Results.ValidationProblem(errors) : null;
    }

    private static IResult BadRequest(string title, string detail) =>
        Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: title, detail: detail);
}
