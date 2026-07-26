using System.IO.Compression;
using LogHarbor.Core.Archiving;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

public static class BackupEndpoints
{
    public const string DatabaseEntryName = "logharbor.db";
    public const string ArchiveEntryPrefix = "archive/";

    public static void MapBackup(this IEndpointRouteBuilder app)
    {
        // One zip holding everything a running instance needs: the SQLite file plus the archive
        // segments. The database alone is NOT a complete backup once archiving has run — segments
        // hold the compressed history and the database only stores their file names, so restoring
        // the .db by itself yields an instance that lists days it can no longer produce.
        app.MapGet("/api/admin/backup", async (
            LogHarborDb db, Archiver archiver, CancellationToken cancellationToken) =>
        {
            var snapshotPath = Path.Combine(Path.GetTempPath(), $"logharbor-snapshot-{Guid.NewGuid():N}.db");
            var zipPath = Path.Combine(Path.GetTempPath(), $"logharbor-backup-{Guid.NewGuid():N}.zip");
            try
            {
                await SnapshotDatabaseAsync(db, snapshotPath, cancellationToken);
                // Snapshot first, segments second: a day archived in between lands in the zip
                // without a row referring to it, which restores harmlessly. The other order
                // would produce the failure this whole endpoint exists to prevent.
                WriteZip(snapshotPath, archiver.ArchiveDirectory, zipPath);
            }
            catch
            {
                Delete(snapshotPath);
                Delete(zipPath);
                throw;
            }
            Delete(snapshotPath);

            // DeleteOnClose: the zip removes itself when the download completes or aborts
            var stream = new FileStream(zipPath, FileMode.Open, FileAccess.Read, FileShare.Read,
                bufferSize: 64 * 1024,
                FileOptions.DeleteOnClose | FileOptions.Asynchronous | FileOptions.SequentialScan);
            return Results.Stream(stream, "application/zip",
                $"logharbor-backup-{DateTime.UtcNow:yyyyMMdd-HHmmss}.zip");
        });
    }

    /// <summary>VACUUM INTO is SQLite's supported online snapshot: consistent while writes
    /// continue, WAL folded in, output compacted. It refuses to overwrite, hence the guid.</summary>
    private static async Task SnapshotDatabaseAsync(
        LogHarborDb db, string snapshotPath, CancellationToken cancellationToken)
    {
        await using var connection = db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "VACUUM INTO $path";
        command.Parameters.AddWithValue("$path", snapshotPath);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static void WriteZip(string snapshotPath, string archiveDirectory, string zipPath)
    {
        using var file = new FileStream(zipPath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        using var zip = new ZipArchive(file, ZipArchiveMode.Create);

        zip.CreateEntryFromFile(snapshotPath, DatabaseEntryName, CompressionLevel.Optimal);

        if (!Directory.Exists(archiveDirectory))
        {
            return;
        }
        foreach (var segment in Directory.EnumerateFiles(archiveDirectory, "*.br"))
        {
            // segments are already Brotli-compressed; deflating them again only costs CPU
            zip.CreateEntryFromFile(segment,
                ArchiveEntryPrefix + Path.GetFileName(segment), CompressionLevel.NoCompression);
        }
    }

    private static void Delete(string path)
    {
        if (File.Exists(path))
        {
            File.Delete(path);
        }
    }
}
