using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.RateLimiting;
using LogHarbor.Api;
using LogHarbor.Api.Alerting;
using LogHarbor.Api.Archiving;
using LogHarbor.Api.Auth;
using LogHarbor.Api.Endpoints;
using LogHarbor.Api.LiveTail;
using LogHarbor.Core.Alerting;
using LogHarbor.Core.Archiving;
using LogHarbor.Core.Storage;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton(new LogHarborDb(
    builder.Configuration["LogHarbor:DatabasePath"] ?? "data/logharbor.db"));
builder.Services.AddSingleton<IEventStore, SqliteEventStore>();
builder.Services.AddSingleton<IApiKeyStore, SqliteApiKeyStore>();
builder.Services.AddSingleton<ISignalStore, SqliteSignalStore>();
builder.Services.AddSingleton<IArchiveStore, SqliteArchiveStore>();

// appsettings values are only defaults: values saved from the Settings page win (docs/archiving.md)
var archiveDefaults = new ArchiveSettings
{
    CompressAfterDays = builder.Configuration.GetValue("LogHarbor:Archive:CompressAfterDays", 90),
    HydrationKeepDays = builder.Configuration.GetValue("LogHarbor:Archive:HydrationKeepDays", 1),
    RetentionDays = builder.Configuration.GetValue("LogHarbor:RetentionDays", 365),
};
builder.Services.AddSingleton<ISettingsStore>(provider =>
    new SqliteSettingsStore(provider.GetRequiredService<LogHarborDb>(), archiveDefaults));
builder.Services.AddSingleton(provider =>
{
    var db = provider.GetRequiredService<LogHarborDb>();
    var archiveDirectory = builder.Configuration["LogHarbor:ArchivePath"]
        ?? Path.Combine(Path.GetDirectoryName(db.DatabasePath)!, "archive");
    return new Archiver(
        provider.GetRequiredService<IArchiveStore>(),
        provider.GetRequiredService<ISettingsStore>(),
        archiveDirectory);
});
builder.Services.AddSingleton<HydrationQueue>();
builder.Services.AddHostedService<HydrationWorker>();

builder.Services.AddSingleton<IAlertStore, SqliteAlertStore>();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<IWebhookSender, HttpWebhookSender>();
builder.Services.AddSingleton<AlertEvaluator>();

// tests disable the schedulers: their timed passes would race the events tests seed
if (builder.Configuration.GetValue("LogHarbor:RunBackgroundJobs", true))
{
    builder.Services.AddHostedService<ArchiveScheduler>();
    builder.Services.AddHostedService<AlertScheduler>();
}

builder.Services.AddSignalR();
builder.Services.AddSingleton<TailSubscriptions>();
builder.Services.AddSingleton<TailBroadcaster>();

builder.Services.AddSingleton<IUserStore, SqliteUserStore>();
builder.Services.AddSingleton<AuthService>();
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "logharbor_session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        // production runs behind an HTTPS reverse proxy; serving over plain HTTP needs an
        // explicit opt-out (LogHarbor__AllowInsecureCookie=true), otherwise browsers drop the
        // Secure cookie and nobody can log in
        options.Cookie.SecurePolicy =
            builder.Environment.IsDevelopment() ||
            builder.Configuration.GetValue("LogHarbor:AllowInsecureCookie", false)
                ? CookieSecurePolicy.SameAsRequest
                : CookieSecurePolicy.Always;
        options.SlidingExpiration = true;
        options.ExpireTimeSpan = TimeSpan.FromDays(7);
        // this is an API + SPA: never redirect to a login page, just answer 401
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
    });
builder.Services.AddAuthorization();

var ingestionOptions = builder.Configuration.GetSection("LogHarbor").Get<IngestionOptions>() ?? new IngestionOptions();
builder.Services.AddSingleton(ingestionOptions);
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // partitioned by API key token: one noisy client cannot starve the others
    options.AddPolicy(IngestionEndpoints.RateLimitPolicy, context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Request.Headers[ApiKeyMiddleware.HeaderName].ToString(),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = ingestionOptions.IngestRateLimitPerMinute,
                Window = TimeSpan.FromMinutes(1),
            }));
    // brute-force protection: partitioned by client IP, counts every attempt
    options.AddPolicy(AuthEndpoints.LoginRateLimitPolicy, context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = ingestionOptions.LoginRateLimitPerMinute,
                Window = TimeSpan.FromMinutes(1),
            }));
});

builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

MigrationRunner.Apply(
    app.Services.GetRequiredService<LogHarborDb>(),
    Path.Combine(AppContext.BaseDirectory, "Migrations"));

// First start with an empty user table seeds the admin account, so LogHarbor is never reachable
// without a login. LOGHARBOR_ADMIN_PASSWORD sets that password (secrets come from the environment,
// never from committed config files, rules.md); with no environment at all, admin/admin is
// seeded and the account can do nothing but change its own password (docs/api.md AUTH).
var seedPassword = builder.Configuration["LOGHARBOR_ADMIN_PASSWORD"];
if (builder.Configuration.GetValue("LogHarbor:SeedDefaultAdmin", true) || !string.IsNullOrEmpty(seedPassword))
{
    var userStore = app.Services.GetRequiredService<IUserStore>();
    if (await userStore.CountAsync() == 0)
    {
        var isDefault = string.IsNullOrEmpty(seedPassword);
        await userStore.CreateAsync(
            "admin", isDefault ? "admin" : seedPassword!, UserRole.Admin, mustChangePassword: isDefault);
    }
}

// unhandled exceptions become ProblemDetails; stack traces never leave the process outside dev (rules.md)
app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
{
    var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    await Results.Problem(
        statusCode: StatusCodes.Status500InternalServerError,
        title: "An unexpected error occurred",
        detail: app.Environment.IsDevelopment() ? exception?.ToString() : null)
        .ExecuteAsync(context);
}));
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseWhen(
    context => context.Request.Path.StartsWithSegments("/api/events/raw"),
    branch => branch.UseMiddleware<ApiKeyMiddleware>());
app.UseRateLimiter();

app.UseAuthentication();
app.UseAuthorization();
// once any user exists, the management API and the live-tail hub need the session cookie;
// viewers additionally get read-only access (AuthPolicy.RequiresAdmin)
app.UseWhen(
    context => AuthPolicy.RequiresAuthentication(context.Request.Path),
    branch => branch.Use(async (context, next) =>
    {
        var authService = context.RequestServices.GetRequiredService<AuthService>();
        if (await authService.IsEnabledAsync(context.RequestAborted))
        {
            if (context.User.Identity?.IsAuthenticated != true)
            {
                await Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Authentication required")
                    .ExecuteAsync(context);
                return;
            }
            if (AuthPolicy.MustChangePassword(context))
            {
                await Results.Problem(statusCode: StatusCodes.Status403Forbidden,
                    title: "Password change required",
                    detail: "This account still has its seeded password; POST /api/auth/password first.")
                    .ExecuteAsync(context);
                return;
            }
            if (!AuthPolicy.IsAdmin(context)
                && AuthPolicy.RequiresAdmin(context.Request.Path, context.Request.Method))
            {
                await Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Admin role required")
                    .ExecuteAsync(context);
                return;
            }
        }
        await next();
    }));

app.MapHealth();
app.MapAuth();
app.MapUsers();
app.MapApiKeys();
app.MapIngestion();
app.MapEvents();
app.MapExport();
app.MapSuggest();
app.MapSignals();
app.MapAlerts();
app.MapStats();
app.MapArchive();
app.MapSettings();
app.MapHub<TailHub>("/hubs/tail");

// single deployable: the SPA build is served from wwwroot, unknown paths fall back to index.html
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallback(async context =>
{
    // an unknown /api or /hubs path is a client error, not a deep link: answering with the SPA's
    // HTML and a 200 would hide typos and broken integrations behind a page that never loads data
    if (context.Request.Path.StartsWithSegments("/api") || context.Request.Path.StartsWithSegments("/hubs"))
    {
        await Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Not found").ExecuteAsync(context);
        return;
    }

    var indexPath = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "index.html");
    if (!File.Exists(indexPath))
    {
        await Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Not found").ExecuteAsync(context);
        return;
    }
    context.Response.ContentType = "text/html";
    await context.Response.SendFileAsync(indexPath);
});

app.Run();

public partial class Program;
