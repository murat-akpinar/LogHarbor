using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class BackupEndpoints
{
    public static void MapBackup(this IEndpointRouteBuilder app)
    {
        // VACUUM INTO is SQLite's supported online snapshot: consistent while writes continue,
        // WAL folded in, output compacted. The guid keeps the target unique because VACUUM INTO
        // refuses to overwrite an existing file.
        app.MapGet("/api/admin/backup", async (LogHarborDb db, CancellationToken cancellationToken) =>
        {
            var tempPath = Path.Combine(Path.GetTempPath(), $"logharbor-backup-{Guid.NewGuid():N}.db");
            try
            {
                await using var connection = db.OpenConnection();
                using var command = connection.CreateCommand();
                command.CommandText = "VACUUM INTO $path";
                command.Parameters.AddWithValue("$path", tempPath);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            catch
            {
                File.Delete(tempPath);
                throw;
            }
            // DeleteOnClose: the snapshot removes itself when the download completes or aborts
            var stream = new FileStream(tempPath, FileMode.Open, FileAccess.Read, FileShare.Read,
                bufferSize: 64 * 1024,
                FileOptions.DeleteOnClose | FileOptions.Asynchronous | FileOptions.SequentialScan);
            return Results.Stream(stream, "application/octet-stream",
                $"logharbor-backup-{DateTime.UtcNow:yyyyMMdd-HHmmss}.db");
        });
    }
}
