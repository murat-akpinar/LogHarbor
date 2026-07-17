namespace LogHarbor.Api.Endpoints;

internal static class RequestBody
{
    /// <summary>Reads at most maxBytes; returns null when the body is larger (chunked bodies have no Content-Length).</summary>
    public static async Task<byte[]?> ReadCappedAsync(
        HttpRequest request, int maxBytes, CancellationToken cancellationToken)
    {
        if (request.ContentLength > maxBytes)
        {
            return null;
        }
        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        int read;
        while ((read = await request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > maxBytes)
            {
                return null;
            }
        }
        return buffer.ToArray();
    }
}
