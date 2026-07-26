using System.Diagnostics;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;
using LogHarbor.Core.Telemetry;

namespace LogHarbor.Core.Archiving;

/// <summary>What one retention pass removed. Kept apart because segments and event rows are
/// different units — summing them produces a number that means nothing.</summary>
public sealed record RetentionResult(int Segments, long Rows)
{
    public bool RemovedAnything => Segments > 0 || Rows > 0;
}

/// <summary>
/// Tiered-storage jobs (docs/archiving.md): compress old days to disk, hydrate them back
/// on demand, evict stale cache rows, and apply retention. File paths are always built
/// server-side from the archive directory (rules.md SECURITY).
/// </summary>
public sealed class Archiver
{
    private static readonly JsonSerializerOptions LineOptions = new(JsonSerializerDefaults.Web);

    private readonly IArchiveStore _store;
    private readonly ISettingsStore _settings;

    public string ArchiveDirectory { get; }

    public Archiver(IArchiveStore store, ISettingsStore settings, string archiveDirectory)
    {
        _store = store;
        _settings = settings;
        ArchiveDirectory = Path.GetFullPath(archiveDirectory);
    }

    /// <summary>
    /// Exports every full UTC day older than CompressAfterDays to a Brotli segment,
    /// verifies it, then deletes the hot rows. Returns the segments created.
    /// </summary>
    public async Task<IReadOnlyList<ArchiveSegment>> RunArchiveAsync(
        DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var started = Stopwatch.GetTimestamp();
        try
        {
            var settings = await _settings.GetArchiveSettingsAsync(cancellationToken);
            if (!settings.ArchivingEnabled)
            {
                return [];
            }

            var cutoffDay = ToDay(now.UtcDateTime.Date.AddDays(-settings.CompressAfterDays));
            var created = new List<ArchiveSegment>();
            foreach (var day in await _store.GetArchivableDaysAsync(cutoffDay, cancellationToken))
            {
                // the day list and the day's rows are read on separate connections, so a retention
                // pass or a manual delete in between can empty it; skipping beats dying on events[^1]
                if (await ArchiveDayAsync(day, cancellationToken) is { } segment)
                {
                    created.Add(segment);
                }
            }

            if (created.Count > 0)
            {
                await _store.IncrementalVacuumAsync(cancellationToken);
            }
            return created;
        }
        finally
        {
            LogHarborMetrics.ArchiveJobDuration.Record(Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        }
    }

    /// <summary>
    /// Loads a claimed (hydrating) segment's file into events_cache and marks it hydrated.
    /// The caller claims the segment via <see cref="IArchiveStore.TryBeginHydrationAsync"/> first.
    /// </summary>
    public async Task HydrateAsync(string day, CancellationToken cancellationToken = default)
    {
        var segment = await _store.FindAsync(day, cancellationToken)
            ?? throw new InvalidOperationException($"no archive segment for day {day}");

        var events = ReadSegmentFile(SegmentPathOf(segment.FilePath));
        if (events.Count != segment.EventCount)
        {
            throw new ArchiveVerificationException(
                $"day {day}: segment file has {events.Count} events, expected {segment.EventCount}.");
        }

        var now = ClefParser.FormatTimestamp(DateTimeOffset.UtcNow);
        await _store.CompleteHydrationAsync(day, events, now, cancellationToken);
    }

    /// <summary>Evicts hydrated segments not read for HydrationKeepDays. Returns the evicted days.</summary>
    public async Task<IReadOnlyList<string>> RunEvictionAsync(
        DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var settings = await _settings.GetArchiveSettingsAsync(cancellationToken);
        var lastAccessedBefore = ClefParser.FormatTimestamp(now.AddDays(-settings.HydrationKeepDays));

        var days = await _store.GetEvictableDaysAsync(lastAccessedBefore, cancellationToken);
        foreach (var day in days)
        {
            await _store.EvictAsync(day, cancellationToken);
        }

        if (days.Count > 0)
        {
            await _store.IncrementalVacuumAsync(cancellationToken);
        }
        return days;
    }

    /// <summary>
    /// Deletes segments older than RetentionDays (row, cache rows, file) and every hot event
    /// past the same cutoff, so retention means the same thing whether archiving is on or off.
    /// </summary>
    /// <remarks>
    /// The hot delete is not optional. A day that already has a segment is never re-archived
    /// (<see cref="IArchiveStore.GetArchivableDaysAsync"/>), so late arrivals for it stay hot —
    /// and while the hot delete only ran with archiving disabled, those rows could never be
    /// archived and never be deleted. On the test instance that had already stranded 22,226
    /// events, 39% of the table, from a single backfill. It also made retention silently mean
    /// max(RetentionDays, CompressAfterDays) for everything else.
    ///
    /// Runs after <see cref="RunArchiveAsync"/> in the scheduler, so a day about to be archived
    /// still is; this only removes what is already past the retention cutoff.
    /// </remarks>
    public async Task<RetentionResult> RunRetentionAsync(
        DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var settings = await _settings.GetArchiveSettingsAsync(cancellationToken);
        var cutoffDay = ToDay(now.UtcDateTime.Date.AddDays(-settings.RetentionDays));

        var expired = await _store.GetSegmentsBeforeAsync(cutoffDay, cancellationToken);
        foreach (var segment in expired)
        {
            // row first: if we crash before the file delete, the orphan file is
            // harmless and replaced on a future archive run; a row without a file is not
            await _store.DeleteSegmentAsync(segment.Day, cancellationToken);
            File.Delete(SegmentPathOf(segment.FilePath));
        }

        var rows = await _store.DeleteHotEventsBeforeAsync(
            SqliteArchiveStore.DayStart(cutoffDay), cancellationToken);

        if (expired.Count > 0 || rows > 0)
        {
            await _store.IncrementalVacuumAsync(cancellationToken);
        }
        return new RetentionResult(expired.Count, rows);
    }

    /// <summary>Null when the day turned out to hold no events — no segment row, no file.</summary>
    private async Task<ArchiveSegment?> ArchiveDayAsync(string day, CancellationToken cancellationToken)
    {
        var events = await _store.ReadDayAsync(day, cancellationToken);
        if (events.Count == 0)
        {
            return null;
        }

        var fileName = $"events-{day}.jsonl.br";
        var finalPath = Path.Combine(ArchiveDirectory, fileName);
        var tempPath = finalPath + ".tmp";

        Directory.CreateDirectory(ArchiveDirectory);
        // leftovers of an interrupted run: without a segment row the file is not authoritative
        File.Delete(finalPath);

        long uncompressedBytes;
        try
        {
            uncompressedBytes = WriteSegmentFile(tempPath, events);

            var verifiedCount = CountVerifiedEvents(tempPath);
            if (verifiedCount != events.Count)
            {
                throw new ArchiveVerificationException(
                    $"day {day}: wrote {events.Count} events but the segment file has {verifiedCount} lines.");
            }
            File.Move(tempPath, finalPath);
        }
        finally
        {
            File.Delete(tempPath);
        }

        var segment = new ArchiveSegment(
            day, fileName, events.Count, new FileInfo(finalPath).Length, uncompressedBytes,
            SegmentStatus.Cold, HydratedAt: null, LastAccessedAt: null);
        try
        {
            // events are id-ordered, so [^1] is the largest exported id
            await _store.CommitSegmentAsync(segment, events[^1].Id, cancellationToken);
        }
        catch
        {
            File.Delete(finalPath);
            throw;
        }
        return segment;
    }

    private static long WriteSegmentFile(string path, IReadOnlyList<Event> events)
    {
        using var file = File.Create(path);
        using var brotli = new BrotliStream(file, CompressionLevel.Optimal);
        using var writer = new StreamWriter(brotli, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

        long uncompressedBytes = 0;
        foreach (var item in events)
        {
            var line = JsonSerializer.Serialize(item, LineOptions);
            writer.Write(line);
            writer.Write('\n');
            uncompressedBytes += Encoding.UTF8.GetByteCount(line) + 1;
        }
        return uncompressedBytes;
    }

    /// <summary>
    /// Streams a segment file back into events. One reader for both callers: verification used to
    /// count lines without parsing them, so a segment whose JSON was corrupt passed the check and
    /// only failed years later at hydrate time. Now the write path proves the file parses.
    /// </summary>
    private static IEnumerable<Event> ReadSegment(string path)
    {
        using var file = File.OpenRead(path);
        using var brotli = new BrotliStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(brotli, Encoding.UTF8);

        while (reader.ReadLine() is { } line)
        {
            if (line.Length == 0)
            {
                continue;
            }
            yield return JsonSerializer.Deserialize<Event>(line, LineOptions)
                ?? throw new ArchiveVerificationException($"{Path.GetFileName(path)}: null event line.");
        }
    }

    private static IReadOnlyList<Event> ReadSegmentFile(string path) => ReadSegment(path).ToList();

    private static long CountVerifiedEvents(string path) => ReadSegment(path).LongCount();

    /// <summary>file_path is stored as a bare file name; strip any directories as defense in depth.</summary>
    public string SegmentPathOf(string filePath) =>
        Path.Combine(ArchiveDirectory, Path.GetFileName(filePath));

    private static string ToDay(DateTime date) => date.ToString("yyyy-MM-dd");
}
