using System.Security.Claims;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class AlertEndpoints
{
    private const int MaxWindowMinutes = 7 * 24 * 60;

    /// <summary>Same ceiling as a rule's window: a silence longer than the longest window a rule
    /// can watch is a rule that should be switched off instead, and saying so is the point —
    /// an acknowledgement that outlives the reason for it is just a disabled rule nobody
    /// remembers disabling.</summary>
    private const int MaxAcknowledgeMinutes = MaxWindowMinutes;

    private static readonly string[] PayloadFormats = ["generic", "slack", "discord"];

    private static readonly string[] Conditions = ["at-least", "silence"];

    public sealed record AlertRequest(
        string? Title, long? SignalId, int? ThresholdCount, int? WindowMinutes, string? WebhookUrl, bool? IsEnabled,
        string? PayloadFormat, string? Condition);

    public sealed record AcknowledgeRequest(int? Minutes);

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
                    request.Title!.Trim(), request.SignalId!.Value, request.ThresholdCount ?? 0,
                    request.WindowMinutes!.Value, request.WebhookUrl!, request.IsEnabled ?? true,
                    request.PayloadFormat ?? "generic", request.Condition ?? "at-least", cancellationToken);
                return Results.Created($"/api/alerts/{created.Id}", created);
            }
            catch (DuplicateAlertTitleException ex)
            {
                return Problems.BadRequest("Duplicate title", ex.Message);
            }
            catch (UnknownSignalException ex)
            {
                return Problems.BadRequest("Unknown signal", ex.Message);
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
                    id, request.Title!.Trim(), request.SignalId!.Value, request.ThresholdCount ?? 0,
                    request.WindowMinutes!.Value, request.WebhookUrl!, request.IsEnabled ?? true,
                    request.PayloadFormat ?? "generic", request.Condition ?? "at-least", cancellationToken);
                return updated is not null
                    ? Results.Ok(updated)
                    : Problems.NotFound("Alert rule not found");
            }
            catch (DuplicateAlertTitleException ex)
            {
                return Problems.BadRequest("Duplicate title", ex.Message);
            }
            catch (UnknownSignalException ex)
            {
                return Problems.BadRequest("Unknown signal", ex.Message);
            }
        });

        group.MapDelete("/{id:long}", async (long id, IAlertStore store, CancellationToken cancellationToken) =>
            await store.DeleteAsync(id, cancellationToken)
                ? Results.NoContent()
                : Problems.NotFound("Alert rule not found"));

        // Acknowledging is not disabling: the rule keeps evaluating the moment the silence
        // expires, so the thing an operator reaches for at 3am cannot leave a rule off forever.
        group.MapPost("/{id:long}/acknowledge", async (
            long id, AcknowledgeRequest request, ClaimsPrincipal user, IAlertStore store,
            CancellationToken cancellationToken) =>
        {
            if (request.Minutes is not (>= 1 and <= MaxAcknowledgeMinutes))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["minutes"] = [$"Must be between 1 and {MaxAcknowledgeMinutes} minutes."],
                });
            }

            var until = ClefParser.FormatTimestamp(DateTimeOffset.UtcNow.AddMinutes(request.Minutes.Value));
            // the name is for the next person to read, so an unauthenticated install (no login
            // configured) records nothing rather than inventing an owner
            var by = user.FindFirstValue(ClaimTypes.Name);
            var acknowledged = await store.AcknowledgeAsync(id, until, by, cancellationToken);
            return acknowledged is not null
                ? Results.Ok(acknowledged)
                : Problems.NotFound("Alert rule not found");
        });

        group.MapDelete("/{id:long}/acknowledge", async (
            long id, IAlertStore store, CancellationToken cancellationToken) =>
        {
            var resumed = await store.AcknowledgeAsync(id, null, null, cancellationToken);
            return resumed is not null
                ? Results.Ok(resumed)
                : Problems.NotFound("Alert rule not found");
        });
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
        var condition = request.Condition ?? "at-least";
        if (!Conditions.Contains(condition))
        {
            errors["condition"] = [$"Must be one of: {string.Join(", ", Conditions)}."];
        }
        if (condition == "at-least" && request.ThresholdCount is not >= 1)
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
        if (request.PayloadFormat is not null && !PayloadFormats.Contains(request.PayloadFormat))
        {
            errors["payloadFormat"] = [$"Must be one of: {string.Join(", ", PayloadFormats)}."];
        }
        return errors.Count > 0 ? Results.ValidationProblem(errors) : null;
    }
}
