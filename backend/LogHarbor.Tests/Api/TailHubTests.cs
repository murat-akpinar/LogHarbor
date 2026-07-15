using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using LogHarbor.Core.Events;

namespace LogHarbor.Tests.Api;

public sealed class TailHubTests : IAsyncLifetime
{
    private static readonly TimeSpan ReceiveTimeout = TimeSpan.FromSeconds(10);

    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;
    private readonly List<HubConnection> _connections = [];

    public TailHubTests() => _client = _factory.CreateClient();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var connection in _connections)
        {
            await connection.DisposeAsync();
        }
        _factory.Dispose();
    }

    /// <summary>Connects over the in-memory test server and captures pushed events.</summary>
    private async Task<(HubConnection Connection, Func<Task<IReadOnlyList<Event>>> NextBatch)> ConnectAsync(string? filter)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(
                new Uri(_factory.Server.BaseAddress, "hubs/tail"),
                options => options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler())
            .Build();
        _connections.Add(connection);

        var batches = Channel.CreateUnbounded<IReadOnlyList<Event>>();
        connection.On<IReadOnlyList<Event>>("EventsArrived", events => batches.Writer.TryWrite(events));

        await connection.StartAsync();
        await connection.InvokeAsync("Subscribe", filter);

        async Task<IReadOnlyList<Event>> NextBatch()
        {
            using var timeout = new CancellationTokenSource(ReceiveTimeout);
            return await batches.Reader.ReadAsync(timeout.Token);
        }

        return (connection, NextBatch);
    }

    private async Task IngestAsync(string clefLines)
    {
        var created = await (await _client.PostAsJsonAsync("/api/apikeys", new { title = "tail" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw")
        {
            Content = new StringContent(clefLines, Encoding.UTF8, "application/vnd.serilog.clef"),
        };
        request.Headers.Add("X-LogHarbor-ApiKey", created.GetProperty("token").GetString());
        var response = await _client.SendAsync(request);
        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Subscribe_WithoutFilter_ReceivesIngestedEvents()
    {
        var (_, nextBatch) = await ConnectAsync(filter: null);

        await IngestAsync("""{"@t":"2026-07-13T10:00:00Z","@l":"Information","@m":"hello tail"}""");

        var received = await nextBatch();
        Assert.Equal("hello tail", Assert.Single(received).Message);
    }

    [Fact]
    public async Task Subscribe_WithFilter_OnlyReceivesMatchingEvents()
    {
        var (_, nextBatch) = await ConnectAsync("@Level = 'Error'");

        await IngestAsync(
            """
            {"@t":"2026-07-13T10:00:00Z","@l":"Information","@m":"ignored"}
            {"@t":"2026-07-13T10:00:01Z","@l":"Error","@m":"boom"}
            """);

        var received = await nextBatch();
        Assert.Equal("boom", Assert.Single(received).Message);
    }

    [Fact]
    public async Task Subscribe_WithInvalidFilter_Fails()
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(
                new Uri(_factory.Server.BaseAddress, "hubs/tail"),
                options => options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler())
            .Build();
        _connections.Add(connection);
        await connection.StartAsync();

        var ex = await Assert.ThrowsAsync<HubException>(
            () => connection.InvokeAsync("Subscribe", "@Bogus = 1"));

        Assert.Contains("unknown built-in field", ex.Message);
    }

    [Fact]
    public async Task Ingestion_SucceedsWithNoSubscribers()
    {
        await IngestAsync("""{"@t":"2026-07-13T10:00:00Z","@l":"Information","@m":"no listeners"}""");

        var page = await _client.GetFromJsonAsync<JsonElement>("/api/events");
        Assert.Equal(1, page.GetProperty("events").GetArrayLength());
    }
}
