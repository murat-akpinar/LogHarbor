using Microsoft.Data.Sqlite;

namespace LogHarbor.Core.Storage;

/// <summary>Owns the database path and opens connections with per-connection pragmas set.</summary>
public sealed class LogHarborDb
{
    public string DatabasePath { get; }

    private readonly string _connectionString;

    public LogHarborDb(string databasePath)
    {
        DatabasePath = Path.GetFullPath(databasePath);
        var directory = Path.GetDirectoryName(DatabasePath);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }
        _connectionString = new SqliteConnectionStringBuilder { DataSource = DatabasePath }.ToString();
    }

    public SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        // busy_timeout and synchronous are per-connection; journal_mode and
        // auto_vacuum are persistent and set once by MigrationRunner
        command.CommandText = "PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;";
        command.ExecuteNonQuery();
        return connection;
    }

    public long CountEvents()
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM events;";
        return (long)(command.ExecuteScalar() ?? 0L);
    }

    public long GetDatabaseSizeBytes()
    {
        var file = new FileInfo(DatabasePath);
        return file.Exists ? file.Length : 0;
    }

    /// <summary>
    /// Whether the database can still be written to. Reads keep succeeding long after writes
    /// stop — a full disk or a read-only mount leaves SELECT working — so a health check built
    /// on reads reports a healthy server that is dropping every batch it receives.
    /// The write is rolled back, so this costs a transaction and changes nothing.
    /// </summary>
    public bool CanWrite()
    {
        try
        {
            using var connection = OpenConnection();
            using var transaction = connection.BeginTransaction();
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            // a real page write: PRAGMA checks and empty transactions can succeed without one
            command.CommandText =
                "CREATE TABLE IF NOT EXISTS write_probe (id INTEGER PRIMARY KEY); " +
                "INSERT INTO write_probe (id) VALUES (1);";
            command.ExecuteNonQuery();
            transaction.Rollback();
            return true;
        }
        catch (SqliteException)
        {
            return false;
        }
    }

    /// <summary>Free bytes on the volume holding the database, or null when the platform
    /// will not say. Turns "the disk filled up" from a surprise into something watchable.</summary>
    public long? GetFreeDiskBytes()
    {
        try
        {
            return new DriveInfo(Path.GetPathRoot(DatabasePath)!).AvailableFreeSpace;
        }
        catch (Exception exception) when (exception is ArgumentException or IOException
                                              or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>
    /// Closes this database's pooled connections so its files can be deleted. Deliberately
    /// scoped to one database: clearing all pools races other databases' live connections.
    /// </summary>
    public void ClearPool()
    {
        using var connection = new SqliteConnection(_connectionString);
        SqliteConnection.ClearPool(connection);
    }
}
