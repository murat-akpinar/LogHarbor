using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;
using Microsoft.Data.Sqlite;

namespace LogHarbor.Tests.Storage;

/// <summary>
/// What the native SQLite underneath this server has to be. The version is pinned in
/// LogHarbor.Core.csproj over the one Microsoft.Data.Sqlite brings in, and a pin is only worth
/// having if something notices when it stops holding — a package bump that quietly restores the
/// transitive version would otherwise be invisible.
///
/// <para>The compile-time options matter more than the version. FTS5 and JSON1 are not part of
/// SQLite by default; they are switches at build time, and every search and every property
/// filter in this product is one or the other. Swapping a native build is precisely how they go
/// missing, and the failure would surface as a query error deep in a page rather than as
/// anything that says "your SQLite has no FTS5".</para>
/// </summary>
public sealed class SqliteBuildTests
{
    /// <summary>CVE-2025-6965 (aggregate terms exceeding available columns) is fixed in 3.50.2.</summary>
    private static readonly Version MinimumVersion = new(3, 50, 2);

    private static string Scalar(string sql)
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return command.ExecuteScalar()?.ToString() ?? "";
    }

    [Fact]
    public void TheNativeLibraryIsPastTheAdvisory()
    {
        var reported = Scalar("select sqlite_version();");

        Assert.True(
            Version.Parse(reported) >= MinimumVersion,
            $"SQLite {reported} is older than {MinimumVersion}; the lib.e_sqlite3 pin in "
            + "LogHarbor.Core.csproj is not taking effect.");
    }

    [Fact]
    public void FullTextSearchIsCompiledIn()
    {
        // the whole free-text half of the query language is one virtual table away
        Assert.Equal("1", Scalar("select sqlite_compileoption_used('ENABLE_FTS5');"));

        using var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "CREATE VIRTUAL TABLE probe USING fts5(body);" +
            "INSERT INTO probe(body) VALUES ('the harbour lights');" +
            "SELECT COUNT(*) FROM probe WHERE probe MATCH 'harbour';";
        Assert.Equal(1L, command.ExecuteScalar());
    }

    [Fact]
    public void JsonExtractionWorks()
    {
        // every structured property this server stores is read back through json_extract
        Assert.Equal("checkout", Scalar("""select json_extract('{"a":{"b":"checkout"}}', '$.a.b');"""));
        // and the quoted step the stores rely on, so a dotted property name is one key
        Assert.Equal("42", Scalar("""select json_extract('{"http.status":42}', '$."http.status"');"""));
    }

    [Fact]
    public async Task TheStoreItselfStillReadsAndWrites()
    {
        // the pin swaps a native binary under a managed provider that did not ship with it, so
        // prove the pairing works through this product's own code, not only through raw SQL
        var path = Path.Combine(Path.GetTempPath(), $"logharbor-sqlitebuild-{Guid.NewGuid():N}.db");
        try
        {
            var db = new LogHarborDb(path);
            MigrationRunner.Apply(db, Path.Combine(AppContext.BaseDirectory, "Migrations"));
            var store = new SqliteEventStore(db);
            await store.WriteBatchAsync([
                new Event(0, "2026-08-09T10:00:00.0000000Z", "Error", "harbour lights failed",
                    null, """{"Service":"beacon"}""", null, "2026-08-09T10:00:00.0000000Z"),
            ]);

            var page = await store.QueryAsync(new EventQuery(
                null, "2026-08-09T09:00:00.0000000Z", "2026-08-09T11:00:00.0000000Z", null, 10));

            Assert.Equal("harbour lights failed", Assert.Single(page.Events).Message);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(path);
        }
    }
}
