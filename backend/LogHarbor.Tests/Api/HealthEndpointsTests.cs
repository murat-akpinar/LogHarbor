using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LogHarbor.Api.Endpoints;
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

    /// <summary>
    /// The case the write probe alone could not see. Measured on a full disk: 2000-event
    /// batches failed with "database or disk is full" while the probe's single row still fit
    /// in a free page, so /healthz kept answering ok. A recorded failure is not a guess about
    /// the next write — it is a write that already did not happen.
    /// </summary>
    [Fact]
    public async Task RecentWriteFailure_MakesHealthDegraded_With503()
    {
        var rejections = _factory.Services.GetRequiredService<IIngestRejectionStore>();
        await rejections.RecordAsync(
            1, RejectionReasons.WriteFailed, "database or disk is full", DateTimeOffset.UtcNow);

        var response = await _client.GetAsync("/healthz");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("degraded", body.GetProperty("status").GetString());
        // the database itself is fine here; only the recorded failure is not
        Assert.True(body.GetProperty("writable").GetBoolean());
        Assert.NotNull(body.GetProperty("lastWriteFailure").GetString());
    }

    [Fact]
    public async Task OldWriteFailure_DoesNotKeepTheServerDegradedForever()
    {
        var rejections = _factory.Services.GetRequiredService<IIngestRejectionStore>();
        await rejections.RecordAsync(1, RejectionReasons.WriteFailed, "yesterday's outage",
            DateTimeOffset.UtcNow - HealthEndpoints.WriteFailureWindow - TimeSpan.FromMinutes(1));

        var response = await _client.GetAsync("/healthz");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Healthy_ReportsRoomForABatch()
    {
        var body = await _client.GetFromJsonAsync<JsonElement>("/healthz");

        Assert.True(body.GetProperty("roomForABatch").GetBoolean());
    }

    /// <summary>A 4xx rejection is the client's problem, not the server's health.</summary>
    [Fact]
    public async Task ClientSideRejections_DoNotAffectHealth()
    {
        var rejections = _factory.Services.GetRequiredService<IIngestRejectionStore>();
        await rejections.RecordAsync(
            1, RejectionReasons.InvalidPayload, "line 1: bad", DateTimeOffset.UtcNow);

        var response = await _client.GetAsync("/healthz");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
