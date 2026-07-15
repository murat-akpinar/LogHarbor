using System.Text;
using LogHarbor.Core.Alerting;

namespace LogHarbor.Api.Alerting;

public sealed class HttpWebhookSender : IWebhookSender
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

    private readonly IHttpClientFactory _httpClientFactory;

    public HttpWebhookSender(IHttpClientFactory httpClientFactory) => _httpClientFactory = httpClientFactory;

    public async Task<string?> SendAsync(string url, string jsonPayload, CancellationToken cancellationToken = default)
    {
        var client = _httpClientFactory.CreateClient(nameof(HttpWebhookSender));
        client.Timeout = Timeout;
        try
        {
            using var content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");
            using var response = await client.PostAsync(url, content, cancellationToken);
            return response.IsSuccessStatusCode ? null : $"webhook answered HTTP {(int)response.StatusCode}";
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException or UriFormatException)
        {
            return $"webhook call failed: {ex.Message}";
        }
    }
}
