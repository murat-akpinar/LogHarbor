using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using LogHarbor.Core.Archiving;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;

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

    private static async Task<ZipArchive> DownloadBackupAsync(HttpClient client)
    {
        var backup = await client.GetAsync("/api/admin/backup");
        Assert.Equal(HttpStatusCode.OK, backup.StatusCode);
        Assert.Contains("logharbor-backup-", backup.Content.Headers.ContentDisposition?.FileName);
        Assert.EndsWith(".zip", backup.Content.Headers.ContentDisposition?.FileName);
        return new ZipArchive(new MemoryStream(await backup.Content.ReadAsByteArrayAsync()));
    }

    private static async Task<byte[]> ReadEntryAsync(ZipArchive zip, string name)
    {
        var entry = zip.GetEntry(name);
        Assert.NotNull(entry);
        using var buffer = new MemoryStream();
        await using (var content = entry!.Open())
        {
            await content.CopyToAsync(buffer);
        }
        return buffer.ToArray();
    }

    [Fact]
    public async Task Backup_ContainsADatabaseSqliteCanOpen()
    {
        var client = NewClient();
        await IngestOneEventAsync(client);

        using var zip = await DownloadBackupAsync(client);
        var database = await ReadEntryAsync(zip, "logharbor.db");

        Assert.Equal("SQLite format 3\0"u8.ToArray(), database.Take(16).ToArray());

        var restoredPath = Path.Combine(Path.GetTempPath(), $"logharbor-restore-{Guid.NewGuid():N}.db");
        await File.WriteAllBytesAsync(restoredPath, database);
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

    /// <summary>The regression this format exists for: the database only stores segment file
    /// names, so a backup without the files restores an instance that lists days it cannot
    /// produce — and says nothing about it.</summary>
    [Fact]
    public async Task Backup_ContainsTheArchiveSegments_NotJustTheDatabase()
    {
        var client = NewClient();
        var events = _factory.Services.GetRequiredService<IEventStore>();
        await events.WriteBatchAsync(
        [
            new Event(0, "2026-03-01T10:00:00.0000000Z", "Error", "archived error", null, null, null,
                "2026-03-01T10:00:01.0000000Z"),
        ]);
        var segments = await _factory.Services.GetRequiredService<Archiver>()
            .RunArchiveAsync(new DateTimeOffset(2026, 7, 13, 12, 0, 0, TimeSpan.Zero));
        var segment = Assert.Single(segments);

        using var zip = await DownloadBackupAsync(client);

        var archived = await ReadEntryAsync(zip, $"archive/{segment.FilePath}");
        Assert.Equal(segment.SizeBytes, archived.Length);
    }

    [Fact]
    public async Task Backup_HoldsOnlyTheDatabase_WhenNothingHasBeenArchived()
    {
        var client = NewClient();
        await IngestOneEventAsync(client);

        using var zip = await DownloadBackupAsync(client);

        Assert.Equal(["logharbor.db"], zip.Entries.Select(entry => entry.FullName));
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
