using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Auth;

/// <summary>Which paths need a session, and which of those only an admin may touch.</summary>
public static class AuthPolicy
{
    /// <summary>Set on the session of an account that has not replaced its seeded password yet.</summary>
    public const string MustChangePasswordClaim = "logharbor:must_change_password";

    /// <summary>
    /// The account still has its seeded password. Everything behind the gate is refused until it
    /// is replaced; /api/auth is outside the gate, so login, logout and the change itself still work.
    /// The claim rides in the cookie, so this costs no database read per request.
    /// </summary>
    public static bool MustChangePassword(HttpContext context) =>
        context.User.HasClaim(MustChangePasswordClaim, "true");

    /// <summary>Ingestion (API-key authenticated) and health stay open; everything else —
    /// including the Swagger explorer — needs the session cookie.</summary>
    public static bool RequiresAuthentication(PathString path) =>
        (path.StartsWithSegments("/api") || path.StartsWithSegments("/hubs")
            || path.StartsWithSegments("/swagger"))
        && !path.StartsWithSegments("/api/events/raw")
        && !path.StartsWithSegments("/api/auth");

    /// <summary>
    /// Viewers are read-only: reads, live tail, filter validation and archive extraction
    /// stay open to them; every other mutation and all of /api/users, /api/admin,
    /// /api/settings/ldap and /swagger is admin-only — /api/admin holds the reads that expose
    /// the whole database (backup), and the Swagger explorer advertises the full API surface.
    /// </summary>
    /// <remarks>
    /// The LDAP settings are read-gated where the archive settings are not, because they are not
    /// a policy but a description of somebody else's infrastructure: the directory host, the base
    /// DN and the name of the group that grants admin. It holds no password, but handing a
    /// read-only account the address of the directory and the group to get into is a map, and
    /// there is no reason a viewer needs it.
    /// </remarks>
    public static bool RequiresAdmin(PathString path, string method)
    {
        if (path.StartsWithSegments("/api/users") || path.StartsWithSegments("/api/admin")
            || path.StartsWithSegments("/api/settings/ldap")
            || path.StartsWithSegments("/swagger"))
        {
            return true;
        }
        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method))
        {
            return false;
        }
        return !path.StartsWithSegments("/api/query/validate")
            && !path.StartsWithSegments("/api/archive/hydrate")
            && !path.StartsWithSegments("/hubs");
    }

    public static bool IsAdmin(HttpContext context) =>
        context.User.IsInRole(UserRole.Admin);
}
