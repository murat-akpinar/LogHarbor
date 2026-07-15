using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using LogHarbor.Api.Auth;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class AuthEndpoints
{
    public const string LoginRateLimitPolicy = "login";
    public const int MinPasswordLength = 8;

    public sealed record LoginRequest(string? Username, string? Password);

    public sealed record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);

    public static void MapAuth(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapPost("/login", LoginAsync).RequireRateLimiting(LoginRateLimitPolicy);
        // cast: a lone HttpContext parameter would otherwise bind to the RequestDelegate overload, discarding the result
        group.MapPost("/logout", (Delegate)LogoutAsync);
        // rate limited like login: it verifies the current password, so it is a guessing oracle too
        group.MapPost("/password", ChangePasswordAsync).RequireRateLimiting(LoginRateLimitPolicy);
        group.MapGet("/status", async (HttpContext context, AuthService authService, CancellationToken cancellationToken) =>
        {
            var enabled = await authService.IsEnabledAsync(cancellationToken);
            var authenticated = !enabled || (context.User.Identity?.IsAuthenticated ?? false);
            return Results.Ok(new
            {
                authRequired = enabled,
                authenticated,
                username = authenticated ? context.User.Identity?.Name : null,
                role = enabled
                    ? context.User.FindFirstValue(ClaimTypes.Role)
                    : UserRole.Admin, // no accounts yet: everyone can do everything
                mustChangePassword = AuthPolicy.MustChangePassword(context),
            });
        });
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        HttpContext context,
        AuthService authService,
        IUserStore userStore,
        CancellationToken cancellationToken)
    {
        if (!await authService.IsEnabledAsync(cancellationToken))
        {
            return Results.Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Auth is not enabled", detail: "No users exist; create one under Settings.");
        }
        if (string.IsNullOrEmpty(request.Username) || string.IsNullOrEmpty(request.Password))
        {
            return Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Invalid credentials");
        }

        var user = await userStore.AuthenticateAsync(request.Username, request.Password, cancellationToken);
        if (user is null)
        {
            return Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Invalid credentials");
        }

        await SignInAsync(context, user);
        return Results.Ok(new
        {
            authenticated = true,
            username = user.Username,
            role = user.Role,
            mustChangePassword = user.MustChangePassword,
        });
    }

    private static async Task<IResult> LogoutAsync(HttpContext context)
    {
        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Results.NoContent();
    }

    /// <summary>Changes the signed-in user's own password. Clears MustChangePassword, which is what
    /// lets a seeded admin/admin account out of the gate (AuthPolicy).</summary>
    private static async Task<IResult> ChangePasswordAsync(
        ChangePasswordRequest request,
        HttpContext context,
        IUserStore userStore,
        CancellationToken cancellationToken)
    {
        var username = context.User.Identity?.Name;
        if (context.User.Identity?.IsAuthenticated != true || username is null)
        {
            return Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Authentication required");
        }
        if (string.IsNullOrEmpty(request.CurrentPassword) || string.IsNullOrEmpty(request.NewPassword))
        {
            return Results.Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request", detail: "currentPassword and newPassword are required.");
        }
        if (request.NewPassword.Length < MinPasswordLength)
        {
            return Results.Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request", detail: $"Password must be at least {MinPasswordLength} characters.");
        }
        if (request.NewPassword == request.CurrentPassword)
        {
            return Results.Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request", detail: "The new password must differ from the current one.");
        }

        // re-verifying beats trusting the cookie: a walked-away-from browser cannot be used to lock the owner out
        var user = await userStore.AuthenticateAsync(username, request.CurrentPassword, cancellationToken);
        if (user is null)
        {
            return Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Invalid credentials");
        }

        await userStore.SetPasswordAsync(user.Id, request.NewPassword, cancellationToken);
        // re-issue the cookie so the must-change claim disappears from this session immediately
        await SignInAsync(context, user with { MustChangePassword = false });
        return Results.NoContent();
    }

    private static Task SignInAsync(HttpContext context, User user)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.Username),
            new(ClaimTypes.Role, user.Role),
        };
        if (user.MustChangePassword)
        {
            claims.Add(new Claim(AuthPolicy.MustChangePasswordClaim, "true"));
        }

        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        return context.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
    }
}
