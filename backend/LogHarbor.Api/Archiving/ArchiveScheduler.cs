using LogHarbor.Core.Archiving;

namespace LogHarbor.Api.Archiving;

/// <summary>
/// Periodic tiered-storage maintenance (docs/archiving.md): eviction hourly,
/// archive + retention once per UTC day. The first pass runs at startup so a
/// server that is restarted often still archives.
/// </summary>
public sealed class ArchiveScheduler : BackgroundService
{
    private readonly Archiver _archiver;
    private readonly ILogger<ArchiveScheduler> _logger;

    public ArchiveScheduler(Archiver archiver, ILogger<ArchiveScheduler> logger)
    {
        _archiver = archiver;
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

            var today = DateOnly.FromDateTime(now.UtcDateTime);
            if (today != lastArchiveDate)
            {
                var created = await _archiver.RunArchiveAsync(now, stoppingToken);
                if (created.Count > 0)
                {
                    _logger.LogInformation("Archived {Count} day(s)", created.Count);
                }
                var removed = await _archiver.RunRetentionAsync(now, stoppingToken);
                if (removed > 0)
                {
                    _logger.LogInformation("Retention removed {Count} segment(s)/row(s)", removed);
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
