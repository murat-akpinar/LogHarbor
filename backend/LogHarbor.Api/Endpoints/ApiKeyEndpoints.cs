using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class ApiKeyEndpoints
{
    public sealed record CreateApiKeyRequest(string? Title);

    public static void MapApiKeys(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/apikeys");

        group.MapGet("/", async (IApiKeyStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.ListAsync(cancellationToken)));

        group.MapPost("/", async (CreateApiKeyRequest request, IApiKeyStore store, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Title))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["title"] = ["Title is required."],
                });
            }
            var created = await store.CreateAsync(request.Title.Trim(), cancellationToken);
            return Results.Created($"/api/apikeys/{created.Id}", created);
        });

        group.MapDelete("/{id:long}", async (long id, IApiKeyStore store, CancellationToken cancellationToken) =>
        {
            await store.RevokeAsync(id, cancellationToken);
            return Results.NoContent();
        });
    }
}
