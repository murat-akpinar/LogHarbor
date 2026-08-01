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

        group.MapGet("/", ListAsync);

        group.MapPost("/", CreateAsync);

        group.MapDelete("/{id:long}", DeleteAsync);
    }

    /// <summary>
    /// Local accounts and the directory principals that have signed in, in one list.
    /// </summary>
    /// <remarks>
    /// The directory rows are history, not accounts: `id` is null because there is nothing to
    /// delete or edit, and `role` is what the directory answered at the last sign-in rather than
    /// something LogHarbor stores and enforces. Access is still added and removed in the
    /// directory — see docs/ldap.md.
    /// </remarks>
    private static async Task<IResult> ListAsync(IUserStore store, CancellationToken cancellationToken)
    {
        var local = await store.ListAsync(cancellationToken);
        var directory = await store.ListDirectoryAsync(cancellationToken);

        var users = local
            .Select(user => new
            {
                id = (long?)user.Id,
                user.Username,
                user.Role,
                user.CreatedAt,
                user.LastLoginAt,
                source = "local",
            })
            .Concat(directory.Select(user => new
            {
                id = (long?)null,
                user.Username,
                Role = user.LastRole,
                CreatedAt = user.FirstSeenAt,
                LastLoginAt = (string?)user.LastLoginAt,
                source = "ldap",
            }));

        return Results.Ok(users);
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
            return Problems.BadRequest("First user must be an admin",
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
            return Problems.BadRequest("Duplicate username", ex.Message);
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
            return Problems.NotFound("User not found");
        }
        if (user.Role == UserRole.Admin && await store.CountAdminsAsync(cancellationToken) == 1)
        {
            return Problems.BadRequest("Cannot delete the last admin",
                "Create another admin first, then delete this one.");
        }

        await store.DeleteAsync(id, cancellationToken);
        authService.Invalidate();
        return Results.NoContent();
    }
}
