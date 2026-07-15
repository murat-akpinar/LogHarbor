using LogHarbor.Core.Archiving;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Archiving;

/// <summary>Loads queued segments into events_cache, one at a time (SQLite has a single writer).</summary>
public sealed class HydrationWorker : BackgroundService
{
    private readonly HydrationQueue _queue;
    private readonly Archiver _archiver;
    private readonly IArchiveStore _archiveStore;
    private readonly ILogger<HydrationWorker> _logger;

    public HydrationWorker(
        HydrationQueue queue, Archiver archiver, IArchiveStore archiveStore, ILogger<HydrationWorker> logger)
    {
        _queue = queue;
        _archiver = archiver;
        _archiveStore = archiveStore;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // a crash mid-hydration leaves segments stuck in 'hydrating'; return them to cold
        // so they can be requested again
        var reset = await _archiveStore.ResetInterruptedHydrationsAsync(stoppingToken);
        if (reset.Count > 0)
        {
            _logger.LogWarning("Reset {Count} interrupted hydration(s): {Days}", reset.Count, string.Join(", ", reset));
        }

        await foreach (var day in _queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await _archiver.HydrateAsync(day, stoppingToken);
                _logger.LogInformation("Hydrated archive segment {Day}", day);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Hydration of {Day} failed; segment returned to cold", day);
                await _archiveStore.AbortHydrationAsync(day, CancellationToken.None);
            }
        }
    }
}
