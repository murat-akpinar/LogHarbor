using Microsoft.Data.Sqlite;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Storage;

public sealed class MigrationRunnerTests : IDisposable
{
    private static readonly string MigrationsDir = Path.Combine(AppContext.BaseDirectory, "Migrations");

    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"logharbor-test-{Guid.NewGuid():N}.db");

    private readonly LogHarborDb _db;

    public MigrationRunnerTests()
    {
        _db = new LogHarborDb(_dbPath);
    }

    [Fact]
    public void Apply_OnFreshDatabase_SetsPragmasAndCreatesSchema()
    {
        MigrationRunner.Apply(_db, MigrationsDir);

        using var connection = _db.OpenConnection();
        Assert.Equal(2L, Scalar(connection, "PRAGMA auto_vacuum;")); // 2 = incremental
        Assert.Equal("wal", Scalar(connection, "PRAGMA journal_mode;"));
        Assert.Equal(1L, Scalar(connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'events';"));
        Assert.Equal(1L, Scalar(connection,
            "SELECT COUNT(*) FROM schema_migrations WHERE name = '001_events.sql';"));
    }

    [Fact]
    public void Apply_Twice_IsIdempotent()
    {
        MigrationRunner.Apply(_db, MigrationsDir);
        long appliedAfterFirstRun;
        using (var connection = _db.OpenConnection())
        {
            appliedAfterFirstRun = (long)Scalar(connection, "SELECT COUNT(*) FROM schema_migrations;");
        }

        MigrationRunner.Apply(_db, MigrationsDir); // would throw "table already exists" if re-applied

        using (var connection = _db.OpenConnection())
        {
            Assert.Equal(appliedAfterFirstRun, Scalar(connection, "SELECT COUNT(*) FROM schema_migrations;"));
        }
    }

    [Fact]
    public void FtsTriggers_KeepIndexInSyncOnInsertAndDelete()
    {
        MigrationRunner.Apply(_db, MigrationsDir);

        using var connection = _db.OpenConnection();
        Execute(connection,
            "INSERT INTO events (timestamp, level, message, ingested_at) " +
            "VALUES ('2026-07-13T10:00:00.0000000Z', 'Error', 'connection refused by peer', " +
            "'2026-07-13T10:00:01.0000000Z');");

        Assert.Equal(1L, Scalar(connection,
            "SELECT COUNT(*) FROM events_fts WHERE events_fts MATCH '\"connection refused\"';"));

        Execute(connection, "DELETE FROM events;");

        Assert.Equal(0L, Scalar(connection,
            "SELECT COUNT(*) FROM events_fts WHERE events_fts MATCH '\"connection refused\"';"));
    }

    public void Dispose()
    {
        _db.ClearPool();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            File.Delete(_dbPath + suffix);
        }
    }

    private static object Scalar(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return command.ExecuteScalar()!;
    }

    private static void Execute(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }
}
