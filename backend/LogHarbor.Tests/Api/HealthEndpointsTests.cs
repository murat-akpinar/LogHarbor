using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LogHarbor.Core.Storage;
using Microsoft.Extensions.DependencyInjection;

namespace LogHarbor.Tests.Api;

public sealed class HealthEndpointsTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public HealthEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task Healthy_ReportsOk_AndSaysItCanWrite()
    {
        var response = await _client.GetAsync("/healthz");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
        Assert.True(body.GetProperty("writable").GetBoolean());
    }

    /// <summary>The measured failure this endpoint was rewritten for: on a full disk the old
    /// check kept answering "ok" because both of its queries were reads, so Docker went on
    /// reporting a healthy container while every batch was lost.</summary>
    [Fact]
    public void WriteProbe_FailsWhenTheDatabaseCannotBeWritten()
    {
        var db = _factory.Services.GetRequiredService<LogHarborDb>();
        Assert.True(db.CanWrite());

        var readOnly = new LogHarborDb(db.DatabasePath + "-missing/nested/logharbor.db");
        Directory.Delete(Path.GetDirectoryName(readOnly.DatabasePath)!, recursive: true);

        Assert.False(readOnly.CanWrite());
    }

    /// <summary>The rollback takes the probe table with it, so a check polled every few
    /// seconds by the container runtime leaves no trace in the schema or the data.</summary>
    [Fact]
    public void WriteProbe_LeavesNothingBehind()
    {
        var db = _factory.Services.GetRequiredService<LogHarborDb>();
        var before = db.CountEvents();

        Assert.True(db.CanWrite());
        Assert.True(db.CanWrite());

        Assert.Equal(before, db.CountEvents());
        using var connection = db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE name = 'write_probe';";
        Assert.Equal(0L, (long)command.ExecuteScalar()!);
    }

    [Fact]
    public async Task Healthz_ReportsFreeDiskSpace()
    {
        var body = await _client.GetFromJsonAsync<JsonElement>("/healthz");

        var free = body.GetProperty("freeDiskBytes");
        Assert.True(free.ValueKind == JsonValueKind.Null || free.GetInt64() > 0);
    }
}
