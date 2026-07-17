using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;

namespace LogHarbor.Tests.Api;

public sealed class BackupEndpointsTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();

    private HttpClient NewClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

    public void Dispose() => _factory.Dispose();

    private static async Task LoginAsync(HttpClient client, string username, string password)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static async Task IngestOneEventAsync(HttpClient client)
    {
        var keyResponse = await client.PostAsJsonAsync("/api/apikeys", new { title = "backup" });
        var token = (await keyResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw")
        {
            Content = new StringContent(
                """{"@t":"2026-07-13T10:00:00Z","@m":"backup me"}""",
                Encoding.UTF8, "application/vnd.serilog.clef"),
        };
        request.Headers.Add("X-LogHarbor-ApiKey", token);
        Assert.Equal(HttpStatusCode.Created, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task Backup_StreamsAConsistentSqliteSnapshot()
    {
        var client = NewClient();
        await IngestOneEventAsync(client);

        var backup = await client.GetAsync("/api/admin/backup");

        Assert.Equal(HttpStatusCode.OK, backup.StatusCode);
        Assert.Contains("logharbor-backup-", backup.Content.Headers.ContentDisposition?.FileName);

        var bytes = await backup.Content.ReadAsByteArrayAsync();
        Assert.Equal("SQLite format 3\0"u8.ToArray(), bytes.Take(16).ToArray());

        // the download must be a database SQLite can actually open, with the data in it
        var restoredPath = Path.Combine(Path.GetTempPath(), $"logharbor-restore-{Guid.NewGuid():N}.db");
        await File.WriteAllBytesAsync(restoredPath, bytes);
        try
        {
            await using var connection = new SqliteConnection(
                $"Data Source={restoredPath};Mode=ReadOnly;Pooling=False");
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "SELECT COUNT(*) FROM events";
            Assert.Equal(1L, (long)command.ExecuteScalar()!);
        }
        finally
        {
            File.Delete(restoredPath);
        }
    }

    [Fact]
    public async Task Backup_IsAdminOnly_EvenThoughItIsAGet()
    {
        var admin = NewClient();
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync(
            "/api/users", new { username = "alice", password = "password123", role = "admin" })).StatusCode);
        await LoginAsync(admin, "alice", "password123");
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync(
            "/api/users", new { username = "bob", password = "password123", role = "viewer" })).StatusCode);

        var viewer = NewClient();
        await LoginAsync(viewer, "bob", "password123");

        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.GetAsync("/api/admin/backup")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/admin/backup")).StatusCode);
    }

    [Fact]
    public async Task Backup_RequiresASession_OnceAuthIsEnabled()
    {
        var bootstrap = NewClient();
        Assert.Equal(HttpStatusCode.Created, (await bootstrap.PostAsJsonAsync(
            "/api/users", new { username = "alice", password = "password123", role = "admin" })).StatusCode);

        var anonymous = NewClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/admin/backup")).StatusCode);
    }
}
