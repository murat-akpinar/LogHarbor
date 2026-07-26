using LogHarbor.Core.Archiving;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Archiving;

/// <summary>
/// Periodic tiered-storage maintenance (docs/archiving.md): eviction hourly,
/// archive + retention once per UTC day. The first pass runs at startup so a
/// server that is restarted often still archives.
/// </summary>
public sealed class ArchiveScheduler : BackgroundService
{
    private readonly Archiver _archiver;
    private readonly ISpanStore _spans;
    private readonly ISettingsStore _settings;
    private readonly IIngestRejectionStore _rejections;
    private readonly LogHarborDb _db;
    private readonly ILogger<ArchiveScheduler> _logger;

    public ArchiveScheduler(
        Archiver archiver, ISpanStore spans, ISettingsStore settings,
        IIngestRejectionStore rejections, LogHarborDb db, ILogger<ArchiveScheduler> logger)
    {
        _archiver = archiver;
        _spans = spans;
        _settings = settings;
        _rejections = rejections;
        _db = db;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var lastArchiveDate = DateOnly.MinValue;
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        try
        {
            do
            {
                lastArchiveDate = await RunOnceAsync(lastArchiveDate, stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            // shutdown
        }
    }

    private async Task<DateOnly> RunOnceAsync(DateOnly lastArchiveDate, CancellationToken stoppingToken)
    {
        var now = DateTimeOffset.UtcNow;
        try
        {
            var evicted = await _archiver.RunEvictionAsync(now, stoppingToken);
            if (evicted.Count > 0)
            {
                _logger.LogInformation("Evicted {Count} hydrated segment(s)", evicted.Count);
            }

            // hourly, not daily: a volume filling up cannot wait until tomorrow, and running
            // out of disk takes the server down (measured) while retention only prunes by age
            var capped = await _archiver.RunSizeCapAsync(_db.GetDatabaseSizeBytes, stoppingToken);
            if (capped.RemovedAnything)
            {
                _logger.LogWarning(
                    "Size cap dropped {Days} oldest day(s), {Rows} hot row(s); database now {Bytes} bytes",
                    capped.DaysDropped, capped.Rows, capped.DatabaseSizeBytes);
            }

            var today = DateOnly.FromDateTime(now.UtcDateTime);
            if (today != lastArchiveDate)
            {
                var created = await _archiver.RunArchiveAsync(now, stoppingToken);
                if (created.Count > 0)
                {
                    _logger.LogInformation("Archived {Count} day(s)", created.Count);
                }
                var removed = await _archiver.RunRetentionAsync(now, stoppingToken);
                if (removed.RemovedAnything)
                {
                    _logger.LogInformation(
                        "Retention removed {Segments} segment(s) and {Rows} hot event row(s)",
                        removed.Segments, removed.Rows);
                }

                var retention = await _settings.GetArchiveSettingsAsync(stoppingToken);
                var spanCutoff = ClefParser.FormatTimestamp(now.AddDays(-retention.RetentionDays));
                var spansRemoved = await _spans.DeleteSpansOlderThanAsync(spanCutoff, stoppingToken);
                if (spansRemoved > 0)
                {
                    _logger.LogInformation("Retention removed {Count} span(s)", spansRemoved);
                }

                // rejection buckets have their own fixed window: they are an operational trail,
                // not log data, so RetentionDays (which users shorten to save disk) must not
                // silently erase the evidence that a client has been failing all week
                var rejectionsRemoved = await _rejections.PruneAsync(
                    SqliteIngestRejectionStore.DefaultKeepDays, stoppingToken);
                if (rejectionsRemoved > 0)
                {
                    _logger.LogInformation(
                        "Retention removed {Count} ingest rejection bucket(s)", rejectionsRemoved);
                }
                lastArchiveDate = today;
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // a failed pass must not kill the scheduler; the next tick retries
            _logger.LogError(ex, "Archive maintenance pass failed");
        }
        return lastArchiveDate;
    }
}
