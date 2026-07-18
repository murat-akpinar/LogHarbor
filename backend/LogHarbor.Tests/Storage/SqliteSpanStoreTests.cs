using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Storage;

public sealed class SqliteSpanStoreTests : IDisposable
{
    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"logharbor-spans-{Guid.NewGuid():N}.db");
    private readonly LogHarborDb _db;
    private readonly SqliteSpanStore _store;

    public SqliteSpanStoreTests()
    {
        _db = new LogHarborDb(_dbPath);
        MigrationRunner.Apply(_db, Path.Combine(AppContext.BaseDirectory, "Migrations"));
        _store = new SqliteSpanStore(_db);
    }

    public void Dispose()
    {
        _db.ClearPool();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            File.Delete(_dbPath + suffix);
        }
    }

    private static Span MakeSpan(string spanId, string start, string traceId = "aaaa", string? parent = null) => new(
        Id: 0, TraceId: traceId, SpanId: spanId, ParentSpanId: parent, Name: "op", Kind: "server",
        Service: "checkout", StartTimestamp: start, DurationMs: 12.5, StatusCode: "ok",
        StatusMessage: null, Attributes: null, IngestedAt: "2026-07-18T10:00:00.0000000Z");

    [Fact]
    public async Task GetTrace_ReturnsOnlyTheTrace_OrderedByStart()
    {
        await _store.WriteBatchAsync(
        [
            MakeSpan("s2", "2026-07-18T10:00:00.2000000Z"),
            MakeSpan("s1", "2026-07-18T10:00:00.1000000Z"),
            MakeSpan("other", "2026-07-18T10:00:00.1500000Z", traceId: "bbbb"),
        ]);

        var spans = await _store.GetTraceAsync("aaaa");

        Assert.Equal(2, spans.Count);
        Assert.Equal(["s1", "s2"], spans.Select(s => s.SpanId));
        Assert.Equal("checkout", spans[0].Service);
        Assert.Equal(12.5, spans[0].DurationMs);
    }

    [Fact]
    public async Task DeleteSpansOlderThan_RemovesOnlyOldRows()
    {
        await _store.WriteBatchAsync(
        [
            MakeSpan("old", "2026-07-10T10:00:00.0000000Z"),
            MakeSpan("new", "2026-07-18T10:00:00.0000000Z"),
        ]);

        var removed = await _store.DeleteSpansOlderThanAsync("2026-07-15T00:00:00.0000000Z");

        Assert.Equal(1, removed);
        Assert.Equal(["new"], (await _store.GetTraceAsync("aaaa")).Select(s => s.SpanId));
    }
}
