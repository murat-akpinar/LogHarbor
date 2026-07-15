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
    /// Closes this database's pooled connections so its files can be deleted. Deliberately
    /// scoped to one database: clearing all pools races other databases' live connections.
    /// </summary>
    public void ClearPool()
    {
        using var connection = new SqliteConnection(_connectionString);
        SqliteConnection.ClearPool(connection);
    }
}
