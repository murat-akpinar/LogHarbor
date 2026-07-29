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

    /// <summary>Everything a rejection is worth recording comes off the request itself: which
    /// key the middleware resolved (0 when none), where it was posted, and who sent it.</summary>
    public async Task RecordAsync(
        HttpContext context, string reason, string? detail, CancellationToken cancellationToken)
    {
        var apiKeyId = ApiKeyIdOf(context);
        var path = context.Request.Path.ToString();
        var client = ClientOf(context);
        var userAgent = context.Request.Headers.UserAgent.ToString();

        // the key id, never the token (rules.md SECURITY)
        _logger.LogWarning(
            "Ingestion rejected on {Path}: {Reason} (api key {ApiKeyId}, client {Client}) {Detail}",
            path, reason, apiKeyId, client, detail);
        LogHarborMetrics.CountRejected(reason);

        try
        {
            await _store.RecordAsync(
                apiKeyId, reason, detail, DateTimeOffset.UtcNow,
                client, string.IsNullOrWhiteSpace(userAgent) ? null : userAgent, cancellationToken);
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

    /// <summary>Who sent it, for the rejection that has no API key to name. The socket address
    /// is what actually connected; X-Forwarded-For is the client's own claim, so both are kept
    /// and neither decides anything — this string is only ever displayed.</summary>
    private static string? ClientOf(HttpContext context)
    {
        var remote = context.Connection.RemoteIpAddress?.ToString();
        var forwarded = context.Request.Headers["X-Forwarded-For"].ToString();
        if (string.IsNullOrWhiteSpace(forwarded))
        {
            return remote;
        }
        var claimed = forwarded.Split(',')[0].Trim();
        return remote is null ? claimed : $"{claimed} via {remote}";
    }
}
