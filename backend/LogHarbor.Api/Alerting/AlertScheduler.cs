using LogHarbor.Core.Alerting;

namespace LogHarbor.Api.Alerting;

/// <summary>Evaluates alert rules once a minute (docs/api.md ALERTS).</summary>
public sealed class AlertScheduler : BackgroundService
{
    private readonly AlertEvaluator _evaluator;
    private readonly ILogger<AlertScheduler> _logger;

    public AlertScheduler(AlertEvaluator evaluator, ILogger<AlertScheduler> logger)
    {
        _evaluator = evaluator;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    var fired = await _evaluator.EvaluateAsync(DateTimeOffset.UtcNow, stoppingToken);
                    if (fired > 0)
                    {
                        _logger.LogInformation("Fired {Count} alert webhook(s)", fired);
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    // a failed pass must not kill the scheduler; the next tick retries
                    _logger.LogError(ex, "Alert evaluation pass failed");
                }
            }
        }
        catch (OperationCanceledException)
        {
            // shutdown
        }
    }
}
