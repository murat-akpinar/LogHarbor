using System.Text.RegularExpressions;
using LogHarbor.Api.Auth;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static partial class UserEndpoints
{
    private const int MinPasswordLength = 8;

    [GeneratedRegex("^[A-Za-z0-9._-]{1,64}$")]
    private static partial Regex UsernamePattern();

    public sealed record CreateUserRequest(string? Username, string? Password, string? Role);

    public static void MapUsers(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/users");

        group.MapGet("/", async (IUserStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.ListAsync(cancellationToken)));

        group.MapPost("/", CreateAsync);

        group.MapDelete("/{id:long}", DeleteAsync);
    }

    private static async Task<IResult> CreateAsync(
        CreateUserRequest request,
        IUserStore store,
        AuthService authService,
        CancellationToken cancellationToken)
    {
        var username = request.Username?.Trim() ?? "";
        var errors = new Dictionary<string, string[]>();
        if (!UsernamePattern().IsMatch(username))
        {
            errors["username"] = ["Use 1-64 letters, digits, dots, dashes or underscores."];
        }
        if (request.Password is null || request.Password.Length < MinPasswordLength)
        {
            errors["password"] = [$"Must be at least {MinPasswordLength} characters."];
        }
        if (request.Role is null || !UserRole.IsValid(request.Role))
        {
            errors["role"] = ["Must be 'admin' or 'viewer'."];
        }
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }
        // a viewer-only install would lock everyone out of user management forever
        if (request.Role != UserRole.Admin && await store.CountAsync(cancellationToken) == 0)
        {
            return BadRequest("First user must be an admin",
                "Create an admin account first; viewers can be added afterwards.");
        }

        try
        {
            var created = await store.CreateAsync(
                username, request.Password!, request.Role!, cancellationToken: cancellationToken);
            authService.Invalidate();
            return Results.Created($"/api/users/{created.Id}", created);
        }
        catch (DuplicateUsernameException ex)
        {
            return BadRequest("Duplicate username", ex.Message);
        }
    }

    private static async Task<IResult> DeleteAsync(
        long id,
        IUserStore store,
        AuthService authService,
        CancellationToken cancellationToken)
    {
        var user = await store.FindAsync(id, cancellationToken);
        if (user is null)
        {
            return Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "User not found");
        }
        if (user.Role == UserRole.Admin && await store.CountAdminsAsync(cancellationToken) == 1)
        {
            return BadRequest("Cannot delete the last admin",
                "Create another admin first, then delete this one.");
        }

        await store.DeleteAsync(id, cancellationToken);
        authService.Invalidate();
        return Results.NoContent();
    }

    private static IResult BadRequest(string title, string detail) =>
        Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: title, detail: detail);
}
