using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class SuggestEndpoints
{
    private const int SuggestionLimit = 10;
    private const int MaxInputLength = 200;

    public static void MapSuggest(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/search/suggest", SuggestAsync);
    }

    /// <summary>Without ?property returns property-name suggestions; with it, value suggestions.</summary>
    private static async Task<IResult> SuggestAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string? property = null,
        string? prefix = null)
    {
        prefix ??= "";
        if (prefix.Length > MaxInputLength || property?.Length > MaxInputLength)
        {
            return Results.Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request", detail: $"property/prefix must be at most {MaxInputLength} characters.");
        }

        var suggestions = string.IsNullOrEmpty(property)
            ? await eventStore.SuggestPropertyNamesAsync(prefix, SuggestionLimit, cancellationToken)
            : await eventStore.SuggestPropertyValuesAsync(property, prefix, SuggestionLimit, cancellationToken);
        return Results.Ok(new { suggestions });
    }
}
