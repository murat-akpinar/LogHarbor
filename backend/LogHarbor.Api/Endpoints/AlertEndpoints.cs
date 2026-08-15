using System.Security.Claims;
using LogHarbor.Api.Auth;
using LogHarbor.Core.Events;
using LogHarbor.Core.Query;
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
        string? PayloadFormat, string? Condition, string? Filter = null);

    public sealed record AcknowledgeRequest(int? Minutes);

    public static void MapAlerts(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/alerts");

        group.MapGet("/", async (
            HttpContext http, IAlertStore store, AuthService authService, CancellationToken cancellationToken) =>
        {
            var rules = await store.ListAsync(cancellationToken);
            // A webhook URL is a credential, not a setting. A Slack or Discord incoming hook is
            // a bearer token in URL form — whoever holds it posts into that channel as this
            // server — and plenty of other targets carry their token in the query string. The
            // viewer role is "read the logs", and every GET is open to it, so the list would
            // otherwise hand a read-only account the keys to every integration. Masked on the
            // server: a screen that hides a field is not a permission.
            if (await authService.IsEnabledAsync(cancellationToken) && !AuthPolicy.IsAdmin(http))
            {
                rules = [.. rules.Select(rule => rule with { WebhookUrl = MaskWebhook(rule.WebhookUrl) })];
            }
            return Results.Ok(rules);
        });

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
                    request.Title!.Trim(), request.SignalId, Trimmed(request.Filter), request.ThresholdCount ?? 0,
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
                    id, request.Title!.Trim(), request.SignalId, Trimmed(request.Filter), request.ThresholdCount ?? 0,
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

    /// <summary>
    /// Enough of a webhook target to recognise the integration, never enough to use it: the
    /// scheme, host and port, with the path and query — where the secret lives — replaced by a
    /// marker. A URL that will not parse cannot be pruned safely, so it goes entirely.
    /// </summary>
    /// <remarks>
    /// Scheme + Authority rather than GetLeftPart(UriPartial.Authority): that overload keeps the
    /// userinfo, so https://user:password@host/hook masked to https://user:password@host/… and
    /// handed a viewer the credential this method exists to withhold. Uri.Authority is host and
    /// port only.
    /// </remarks>
    private static string MaskWebhook(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var parsed)
            ? $"{parsed.Scheme}://{parsed.Authority}/…"
            : "…";

    private static IResult? Validate(AlertRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(request.Title))
        {
            errors["title"] = ["Title is required."];
        }
        ValidateCondition(request, errors);
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

    /// <summary>
    /// A rule watches exactly one thing: a saved signal, or a filter of its own. Both at once has
    /// no meaning — there would be no way to tell which one fired — and neither leaves nothing to
    /// evaluate. The rule's own filter is parsed here rather than at evaluation time, because a
    /// typo caught while the form is open is a red field, and a typo caught an hour later is a
    /// rule that quietly never fires.
    /// </summary>
    private static void ValidateCondition(AlertRequest request, Dictionary<string, string[]> errors)
    {
        var filter = Trimmed(request.Filter);
        if (request.SignalId is not null && filter is not null)
        {
            errors["filter"] = ["Watch a signal or a filter, not both."];
            return;
        }
        if (request.SignalId is null && filter is null)
        {
            errors["filter"] = ["Enter a filter, or pick a saved signal."];
            return;
        }
        if (filter is null)
        {
            return;
        }
        try
        {
            QueryParser.Parse(filter);
        }
        catch (QueryParseException ex)
        {
            errors["filter"] = [ex.Message];
        }
    }

    /// <summary>Whitespace is not a filter: a blank box means "no filter here", not an empty one.</summary>
    private static string? Trimmed(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
