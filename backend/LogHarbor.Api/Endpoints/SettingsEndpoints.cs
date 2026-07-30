using LogHarbor.Core.Auth;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class SettingsEndpoints
{
    public sealed record ArchiveSettingsRequest(
        int? CompressAfterDays, int? HydrationKeepDays, int? RetentionDays, long? MaxDatabaseBytes);

    /// <summary>Below this a cap would fight the ingestion limits rather than protect the disk:
    /// one MaxBatchBytes batch has to fit with room to spare.</summary>
    public const long MinimumSizeCapBytes = 64 * 1024 * 1024;

    public static void MapSettings(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/settings");

        group.MapGet("/archive", async (ISettingsStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.GetArchiveSettingsAsync(cancellationToken)));

        group.MapPut("/archive", async (
            ArchiveSettingsRequest request, ISettingsStore store, CancellationToken cancellationToken) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (request.CompressAfterDays is not >= 0)
            {
                errors["compressAfterDays"] = ["Must be 0 (disabled) or a positive number of days."];
            }
            if (request.HydrationKeepDays is not >= 1)
            {
                errors["hydrationKeepDays"] = ["Must be at least 1 day."];
            }
            if (request.RetentionDays is not >= 1)
            {
                errors["retentionDays"] = ["Must be at least 1 day."];
            }
            // retention shorter than the compression delay means every day is archived to a file
            // and deleted again on the same pass — the compression work is pure waste, and the
            // setting reads as if it keeps data longer than it does
            if (errors.Count == 0 && request.CompressAfterDays > 0
                && request.RetentionDays < request.CompressAfterDays)
            {
                errors["retentionDays"] = [
                    $"Must be at least the compression delay ({request.CompressAfterDays} days), " +
                    "otherwise days would be compressed and deleted on the same pass."];
            }
            // Omitted means "leave it alone", not "disable it": the field arrived after the
            // other three, and a client that does not know about it must not silently switch
            // off a ceiling someone set deliberately.
            if (request.MaxDatabaseBytes is < 0)
            {
                errors["maxDatabaseBytes"] = ["Must be 0 (disabled) or a positive size in bytes."];
            }
            // a tiny but non-zero cap would delete history on every pass and still never fit,
            // so refuse it rather than let it quietly shred the data
            else if (request.MaxDatabaseBytes is > 0 and < MinimumSizeCapBytes)
            {
                errors["maxDatabaseBytes"] = [
                    $"Must be 0 (disabled) or at least {MinimumSizeCapBytes / (1024 * 1024)} MB."];
            }
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            var current = await store.GetArchiveSettingsAsync(cancellationToken);
            var settings = new ArchiveSettings
            {
                CompressAfterDays = request.CompressAfterDays!.Value,
                HydrationKeepDays = request.HydrationKeepDays!.Value,
                RetentionDays = request.RetentionDays!.Value,
                MaxDatabaseBytes = request.MaxDatabaseBytes ?? current.MaxDatabaseBytes,
            };
            await store.SaveArchiveSettingsAsync(settings, cancellationToken);
            return Results.Ok(settings);
        });

        group.MapGet("/ldap", async (ISettingsStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.GetLdapSettingsAsync(cancellationToken)));

        group.MapPut("/ldap", async (
            LdapSettingsRequest request, ISettingsStore store, Auth.AuthService authService,
            CancellationToken cancellationToken) =>
        {
            var settings = request.ToSettings();
            var errors = Validate(settings);
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }
            await store.SaveLdapSettingsAsync(settings, cancellationToken);
            // enabling LDAP turns authentication on even with no local users; the gate caches
            // that answer, so it has to be told
            authService.Invalidate();
            return Results.Ok(settings);
        });

        // The point of the card. Everything that can be wrong here — a wrong baseDn, a group
        // spelled differently in this domain, a certificate nobody trusts — is invisible until
        // somebody tries to sign in, and then it is a 401 with no reason attached. This answers
        // with the groups the directory actually returned and the role they map to, and creates
        // no session, so an admin can find out before the users do.
        group.MapPost("/ldap/test", async (
            LdapTestRequest request,
            ISettingsStore store,
            ILdapAuthenticator ldap,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrEmpty(request.Username) || string.IsNullOrEmpty(request.Password))
            {
                return Results.Problem(statusCode: StatusCodes.Status400BadRequest,
                    title: "Invalid request", detail: "username and password are required.");
            }

            // test what is on screen when it is sent, so the button can be pressed before saving;
            // falls back to what is stored when the caller sends credentials only
            var settings = request.Settings?.ToSettings() ?? await store.GetLdapSettingsAsync(cancellationToken);
            // "enabled" is about whether the login page offers it, not about whether a test may run
            var result = await ldap.AuthenticateAsync(
                settings with { Enabled = true }, request.Username, request.Password, cancellationToken);

            return Results.Ok(new
            {
                bound = result.Bound,
                succeeded = result.Succeeded,
                role = result.Role,
                groups = result.Groups,
                // safe here and nowhere else: this endpoint is admin-only and creates no session
                detail = result.Failure,
            });
        });
    }

    public sealed record LdapTestRequest(string? Username, string? Password, LdapSettingsRequest? Settings);

    public sealed record LdapSettingsRequest(
        bool? Enabled,
        string? Host,
        int? Port,
        string? Security,
        string? BaseDn,
        string? UpnSuffix,
        string? UserDnPattern,
        string? AdminGroup,
        string? ViewerGroup,
        bool? NestedGroups,
        bool? AllowInvalidCertificate)
    {
        public LdapSettings ToSettings() => new()
        {
            AllowInvalidCertificate = AllowInvalidCertificate ?? false,
            Enabled = Enabled ?? false,
            Host = (Host ?? "").Trim(),
            Port = Port ?? 636,
            Security = (Security ?? LdapSecurity.Ldaps).Trim().ToLowerInvariant(),
            BaseDn = (BaseDn ?? "").Trim(),
            UpnSuffix = (UpnSuffix ?? "").Trim(),
            UserDnPattern = (UserDnPattern ?? "").Trim(),
            AdminGroup = (AdminGroup ?? "").Trim(),
            ViewerGroup = (ViewerGroup ?? "").Trim(),
            NestedGroups = NestedGroups ?? false,
        };
    }

    /// <summary>
    /// Everything that would otherwise only show up as a 401 with no reason attached.
    /// </summary>
    /// <remarks>
    /// Only enforced when LDAP is being switched on: a half-filled card that is saved disabled
    /// is someone still typing, and refusing to save it loses their work.
    /// </remarks>
    private static Dictionary<string, string[]> Validate(LdapSettings settings)
    {
        var errors = new Dictionary<string, string[]>();
        if (!LdapSecurity.IsValid(settings.Security))
        {
            errors["security"] = [$"Must be one of {LdapSecurity.Ldaps}, {LdapSecurity.StartTls}, {LdapSecurity.None}."];
        }
        if (settings.Port is < 1 or > 65535)
        {
            errors["port"] = ["Must be between 1 and 65535."];
        }
        if (!settings.Enabled)
        {
            return errors;
        }

        if (settings.Host.Length == 0)
        {
            errors["host"] = ["Required when LDAP sign-in is enabled."];
        }
        if (settings.BaseDn.Length == 0)
        {
            errors["baseDn"] = ["Required when LDAP sign-in is enabled."];
        }
        // without one of these there is no way to turn a username into something to bind as,
        // and every sign-in fails identically no matter what the user types
        if (settings.UserDnPattern.Length == 0 && settings.UpnSuffix.Length == 0)
        {
            var message = "Set a UPN suffix (Active Directory) or a user DN pattern (anything else); " +
                          "without one there is nothing to bind as.";
            errors["upnSuffix"] = [message];
            errors["userDnPattern"] = [message];
        }
        if (settings.UserDnPattern.Length > 0 && !settings.UserDnPattern.Contains("{0}", StringComparison.Ordinal))
        {
            errors["userDnPattern"] = ["Must contain {0}, which is replaced with the username."];
        }
        // both empty means nobody can ever be granted a role, so every correct password is
        // still a 401 — the single most confusing way for this feature to be misconfigured
        if (settings.AdminGroup.Length == 0 && settings.ViewerGroup.Length == 0)
        {
            var message = "Set at least one group, otherwise no directory user can be granted a role.";
            errors["adminGroup"] = [message];
            errors["viewerGroup"] = [message];
        }
        return errors;
    }
}
