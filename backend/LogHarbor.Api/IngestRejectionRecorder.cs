using LogHarbor.Core.Storage;
using LogHarbor.Core.Telemetry;

namespace LogHarbor.Api;

/// <summary>
/// One place where a turned-away ingestion request becomes visible: a counter, a warning in
/// the server log, and a row the UI can show. Recording must never be the reason a request
/// fails, so a storage error is logged and swallowed — the client already has its 4xx.
/// </summary>
public sealed class IngestRejectionRecorder
{
    private readonly IIngestRejectionStore _store;
    private readonly ILogger<IngestRejectionRecorder> _logger;

    public IngestRejectionRecorder(IIngestRejectionStore store, ILogger<IngestRejectionRecorder> logger)
    {
        _store = store;
        _logger = logger;
    }

    /// <summary>apiKeyId 0 means the request carried no valid key.</summary>
    public async Task RecordAsync(
        long apiKeyId, string reason, string? detail, string path, CancellationToken cancellationToken)
    {
        // the key id, never the token (rules.md SECURITY)
        _logger.LogWarning(
            "Ingestion rejected on {Path}: {Reason} (api key {ApiKeyId}) {Detail}",
            path, reason, apiKeyId, detail);
        LogHarborMetrics.CountRejected(reason);

        try
        {
            await _store.RecordAsync(apiKeyId, reason, detail, DateTimeOffset.UtcNow, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            // the client hung up mid-rejection; nothing to record and nothing to report
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Could not store the ingestion rejection");
        }
    }

    /// <summary>Reads the key the ApiKeyMiddleware resolved, or 0 when it rejected the request.</summary>
    public static long ApiKeyIdOf(HttpContext context) =>
        context.Items.TryGetValue(ApiKeyMiddleware.KeyIdItem, out var id) && id is long keyId ? keyId : 0;
}
