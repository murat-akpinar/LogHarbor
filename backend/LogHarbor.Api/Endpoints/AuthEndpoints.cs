using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using LogHarbor.Api.Auth;
using LogHarbor.Core.Auth;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class AuthEndpoints
{
    public const string LoginRateLimitPolicy = "login";
    public const int MinPasswordLength = 8;

    /// <summary>Method is "standard" (the local user table) or "ldap"; absent means standard,
    /// so a client written before directory sign-in existed keeps working.</summary>
    public sealed record LoginRequest(string? Username, string? Password, string? Method);

    public const string LdapMethod = "ldap";

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
                // unauthenticated on purpose: the login page has to know whether to offer the
                // directory tab before anyone has signed in, and "this server can talk to a
                // directory" is not something an attacker learns anything from
                ldapEnabled = await authService.IsLdapEnabledAsync(cancellationToken),
            });
        });
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        HttpContext context,
        AuthService authService,
        IUserStore userStore,
        ISettingsStore settingsStore,
        ILdapAuthenticator ldap,
        ILoggerFactory loggerFactory,
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

        var user = string.Equals(request.Method, LdapMethod, StringComparison.OrdinalIgnoreCase)
            ? await AuthenticateLdapAsync(
                request, settingsStore, ldap, loggerFactory.CreateLogger("LogHarbor.Ldap"), cancellationToken)
            : await userStore.AuthenticateAsync(request.Username, request.Password, cancellationToken);
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

    /// <summary>
    /// A directory user as a <see cref="User"/>, without a row in the users table.
    /// </summary>
    /// <remarks>
    /// Nothing is written locally on purpose: there is no password to keep, and the role has to
    /// be re-read from the directory on every login anyway — a mirrored copy goes stale the
    /// moment somebody is moved out of a group, and then LogHarbor is enforcing a membership the
    /// directory no longer agrees with. Id 0 marks a principal with no local row, which is why
    /// UserStillExistsAsync has to let it through.
    /// </remarks>
    private static async Task<User?> AuthenticateLdapAsync(
        LoginRequest request,
        ISettingsStore settingsStore,
        ILdapAuthenticator ldap,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var settings = await settingsStore.GetLdapSettingsAsync(cancellationToken);
        var result = await ldap.AuthenticateAsync(
            settings, request.Username!, request.Password!, cancellationToken);
        if (result.Succeeded)
        {
            return new User(0, request.Username!, result.Role!, "", MustChangePassword: false);
        }

        // the caller gets 401 and nothing else whichever of these it was; the operator needs to
        // know which, or a misconfigured baseDn is indistinguishable from a typo'd password
        logger.LogWarning(
            "LDAP sign-in refused for {Username}: {Reason}", request.Username, result.Failure);
        return null;
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
            // 0 for a directory principal (AuthService.DirectoryPrincipalId): no local row to point at
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
