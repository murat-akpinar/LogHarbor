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

    private readonly RequestDelegate _next;

    public ApiKeyMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, IApiKeyStore apiKeys)
    {
        var token = context.Request.Headers[HeaderName].ToString();
        if (token.Length == 0)
        {
            token = context.Request.Headers[SeqHeaderName].ToString();
        }

        var keyId = token.Length == 0
            ? null
            : await apiKeys.AuthenticateAsync(token, context.RequestAborted);

        if (keyId is null)
        {
            await Results.Problem(statusCode: StatusCodes.Status401Unauthorized,
                title: "Missing or invalid API key").ExecuteAsync(context);
            return;
        }

        context.Items[KeyIdItem] = keyId.Value;
        await _next(context);
    }
}
