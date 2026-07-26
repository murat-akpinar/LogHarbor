using LogHarbor.Core.Storage;

namespace LogHarbor.Api;

/// <summary>Requires a valid API key header; applied only to ingestion routes (Program.cs UseWhen).</summary>
public sealed class ApiKeyMiddleware
{
    public const string HeaderName = "X-LogHarbor-ApiKey";

    /// <summary>Seq's header name. Accepted so Seq sinks (Serilog, seqlog, winston-seq) work unchanged;
    /// they already speak CLEF to /api/events/raw, only the header name differs.</summary>
    public const string SeqHeaderName = "X-Seq-ApiKey";

    public const string KeyIdItem = "ApiKeyId";

    /// <summary>
    /// The request's API key: primary header, then the Seq alias. Single source of truth so the
    /// pipeline and the ingestion rate limiter can never disagree about which client a request
    /// belongs to — the limiter used to read the primary header only, which put every Seq sink
    /// on the server into one shared "" partition.
    /// </summary>
    public static string ReadToken(HttpRequest request)
    {
        var token = request.Headers[HeaderName].ToString();
        return token.Length > 0 ? token : request.Headers[SeqHeaderName].ToString();
    }

    private readonly RequestDelegate _next;

    public ApiKeyMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(
        HttpContext context, IApiKeyStore apiKeys, IngestRejectionRecorder rejections)
    {
        var token = ReadToken(context.Request);

        var keyId = token.Length == 0
            ? null
            : await apiKeys.AuthenticateAsync(token, context.RequestAborted);

        if (keyId is null)
        {
            await rejections.RecordAsync(0, RejectionReasons.Unauthorized,
                token.Length == 0 ? "no API key header" : "the key is unknown or revoked",
                context.Request.Path, context.RequestAborted);
            await Results.Problem(statusCode: StatusCodes.Status401Unauthorized,
                title: "Missing or invalid API key").ExecuteAsync(context);
            return;
        }

        context.Items[KeyIdItem] = keyId.Value;
        await _next(context);
    }
}
