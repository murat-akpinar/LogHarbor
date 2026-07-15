using Microsoft.Data.Sqlite;

namespace LogHarbor.Core.Storage;

/// <summary>Applies numbered .sql files in filename order, once each, tracked in schema_migrations.</summary>
public static class MigrationRunner
{
    public static void Apply(LogHarborDb db, string migrationsDirectory)
    {
        using var connection = db.OpenConnection();

        // auto_vacuum only takes effect while the database has no tables,
        // so it must run before the first migration creates one
        if (IsEmptyDatabase(connection))
        {
            Execute(connection, "PRAGMA auto_vacuum=INCREMENTAL;");
        }
        Execute(connection, "PRAGMA journal_mode=WAL;");

        Execute(connection,
            "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");

        var applied = GetAppliedNames(connection);
        var files = Directory.GetFiles(migrationsDirectory, "*.sql")
            .OrderBy(Path.GetFileName, StringComparer.Ordinal);

        foreach (var file in files)
        {
            var name = Path.GetFileName(file);
            if (applied.Contains(name))
            {
                continue;
            }

            using var transaction = connection.BeginTransaction();
            using (var migration = connection.CreateCommand())
            {
                migration.Transaction = transaction;
                migration.CommandText = File.ReadAllText(file);
                migration.ExecuteNonQuery();
            }
            using (var record = connection.CreateCommand())
            {
                record.Transaction = transaction;
                record.CommandText = "INSERT INTO schema_migrations (name, applied_at) VALUES (@name, @appliedAt);";
                record.Parameters.AddWithValue("@name", name);
                record.Parameters.AddWithValue("@appliedAt", DateTime.UtcNow.ToString("o"));
                record.ExecuteNonQuery();
            }
            transaction.Commit();
        }
    }

    private static bool IsEmptyDatabase(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master;";
        return (long)(command.ExecuteScalar() ?? 0L) == 0;
    }

    private static HashSet<string> GetAppliedNames(SqliteConnection connection)
    {
        var names = new HashSet<string>();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT name FROM schema_migrations;";
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            names.Add(reader.GetString(0));
        }
        return names;
    }

    private static void Execute(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }
}
