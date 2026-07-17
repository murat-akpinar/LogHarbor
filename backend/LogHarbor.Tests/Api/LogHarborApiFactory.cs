using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Api;

/// <summary>In-memory app with a temp database and small ingestion limits so limit tests stay cheap.</summary>
public sealed class LogHarborApiFactory : WebApplicationFactory<Program>
{
    public const int MaxBatchBytes = 2048;
    public const int MaxEventBytes = 512;
    public const int RateLimitPerMinute = 3;
    public const int LoginRateLimitPerMinute = 5;

    private readonly string? _adminPassword;
    private readonly bool _seedDefaultAdmin;
    private readonly string? _environment;
    private readonly string? _otlpMetricsEndpoint;

    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"logharbor-test-{Guid.NewGuid():N}.db");

    public string ArchivePath => _dbPath + "-archive";

    /// <param name="adminPassword">When set, the app starts with admin auth enabled.</param>
    /// <param name="seedDefaultAdmin">Production seeds admin/admin; tests opt in, so the rest of
    /// them keep exercising the no-users, no-auth path without logging in first.</param>
    /// <param name="environment">WebApplicationFactory defaults to Development; tests that pin
    /// production-only behavior (Swagger availability) pass "Production".</param>
    /// <param name="otlpMetricsEndpoint">When set, plays the OTEL_EXPORTER_OTLP_ENDPOINT env var
    /// so the app registers its OpenTelemetry metrics pipeline (off by default, like production).</param>
    public LogHarborApiFactory(
        string? adminPassword = null, bool seedDefaultAdmin = false, string? environment = null,
        string? otlpMetricsEndpoint = null)
    {
        _adminPassword = adminPassword;
        _seedDefaultAdmin = seedDefaultAdmin;
        _environment = environment;
        _otlpMetricsEndpoint = otlpMetricsEndpoint;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        if (_environment is not null)
        {
            builder.UseEnvironment(_environment);
        }
        if (_otlpMetricsEndpoint is not null)
        {
            builder.UseSetting("OTEL_EXPORTER_OTLP_ENDPOINT", _otlpMetricsEndpoint);
        }
        builder.UseSetting("LogHarbor:DatabasePath", _dbPath);
        // the scheduler's startup pass would race seeded events; archive tests call Archiver directly
        builder.UseSetting("LogHarbor:RunBackgroundJobs", "false");
        // the default (db directory + /archive) would be the shared temp dir; isolate per test run
        builder.UseSetting("LogHarbor:ArchivePath", ArchivePath);
        builder.UseSetting("LogHarbor:MaxBatchBytes", MaxBatchBytes.ToString());
        builder.UseSetting("LogHarbor:MaxEventBytes", MaxEventBytes.ToString());
        builder.UseSetting("LogHarbor:IngestRateLimitPerMinute", RateLimitPerMinute.ToString());
        builder.UseSetting("LogHarbor:LoginRateLimitPerMinute", LoginRateLimitPerMinute.ToString());
        builder.UseSetting("LogHarbor:SeedDefaultAdmin", _seedDefaultAdmin.ToString());
        if (_adminPassword is not null)
        {
            builder.UseSetting("LOGHARBOR_ADMIN_PASSWORD", _adminPassword);
        }
    }

    private bool _cleanedUp;

    protected override void Dispose(bool disposing)
    {
        // base.DisposeAsync re-enters Dispose(true) after the provider is gone, and the
        // finalizer passes disposing: false; both must skip straight to the base class
        if (!disposing || _cleanedUp)
        {
            base.Dispose(disposing);
            return;
        }
        _cleanedUp = true;

        // resolve before base.Dispose tears the service provider down; clearing only this
        // database's pool avoids racing other test classes' live connections
        var db = Services.GetRequiredService<LogHarborDb>();
        base.Dispose(disposing);
        db.ClearPool();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            File.Delete(_dbPath + suffix);
        }
        if (Directory.Exists(ArchivePath))
        {
            Directory.Delete(ArchivePath, recursive: true);
        }
    }
}
