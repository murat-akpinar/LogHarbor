using LogHarbor.Core.Query;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class SignalEndpoints
{
    public sealed record SignalRequest(string? Title, string? Filter);

    public static void MapSignals(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/signals");

        group.MapGet("/", async (ISignalStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.ListAsync(cancellationToken)));

        group.MapPost("/", async (SignalRequest request, ISignalStore store, CancellationToken cancellationToken) =>
        {
            var validationError = Validate(request, out var title, out var filter);
            if (validationError is not null)
            {
                return validationError;
            }
            try
            {
                var created = await store.CreateAsync(title, filter, cancellationToken);
                return Results.Created($"/api/signals/{created.Id}", created);
            }
            catch (DuplicateSignalTitleException ex)
            {
                return BadRequest("Duplicate title", ex.Message);
            }
        });

        group.MapPut("/{id:long}", async (long id, SignalRequest request, ISignalStore store, CancellationToken cancellationToken) =>
        {
            var validationError = Validate(request, out var title, out var filter);
            if (validationError is not null)
            {
                return validationError;
            }
            try
            {
                var updated = await store.UpdateAsync(id, title, filter, cancellationToken);
                return updated is not null
                    ? Results.Ok(updated)
                    : Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Signal not found");
            }
            catch (DuplicateSignalTitleException ex)
            {
                return BadRequest("Duplicate title", ex.Message);
            }
        });

        group.MapDelete("/{id:long}", async (long id, ISignalStore store, CancellationToken cancellationToken) =>
        {
            try
            {
                return await store.DeleteAsync(id, cancellationToken)
                    ? Results.NoContent()
                    : Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Signal not found");
            }
            catch (SignalInUseException ex)
            {
                return BadRequest("Signal is in use", ex.Message);
            }
        });
    }

    private static IResult? Validate(SignalRequest request, out string title, out string filter)
    {
        title = request.Title?.Trim() ?? "";
        filter = request.Filter?.Trim() ?? "";

        if (title.Length == 0)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["title"] = ["Title is required."] });
        }
        if (filter.Length == 0)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["filter"] = ["Filter is required."] });
        }
        try
        {
            QueryParser.Parse(filter);
        }
        catch (QueryParseException ex)
        {
            return BadRequest("Invalid filter", $"{ex.Message} (position {ex.Position})");
        }
        return null;
    }

    private static IResult BadRequest(string title, string detail) =>
        Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: title, detail: detail);
}
