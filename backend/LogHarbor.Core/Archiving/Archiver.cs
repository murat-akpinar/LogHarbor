using System.IO.Compression;
using System.Text;
using System.Text.Json;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Core.Archiving;

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
        var settings = await _settings.GetArchiveSettingsAsync(cancellationToken);
        if (!settings.ArchivingEnabled)
        {
            return [];
        }

        var cutoffDay = ToDay(now.UtcDateTime.Date.AddDays(-settings.CompressAfterDays));
        var created = new List<ArchiveSegment>();
        foreach (var day in await _store.GetArchivableDaysAsync(cutoffDay, cancellationToken))
        {
            created.Add(await ArchiveDayAsync(day, cancellationToken));
        }

        if (created.Count > 0)
        {
            await _store.IncrementalVacuumAsync(cancellationToken);
        }
        return created;
    }

    /// <summary>
    /// Loads a claimed (hydrating) segment's file into events_cache and marks it hydrated.
    /// The caller claims the segment via <see cref="IArchiveStore.TryBeginHydrationAsync"/> first.
    /// </summary>
    public async Task HydrateAsync(string day, CancellationToken cancellationToken = default)
    {
        var segment = await _store.FindAsync(day, cancellationToken)
            ?? throw new InvalidOperationException($"no archive segment for day {day}");

        var events = ReadSegmentFile(SegmentPath(segment.FilePath));
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
    /// Deletes segments older than RetentionDays (row, cache rows, file). When archiving is
    /// disabled, deletes hot events past retention directly so growth stays bounded.
    /// </summary>
    public async Task<int> RunRetentionAsync(
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
            File.Delete(SegmentPath(segment.FilePath));
        }

        var removed = expired.Count;
        if (!settings.ArchivingEnabled)
        {
            removed += (int)await _store.DeleteHotEventsBeforeAsync(
                SqliteArchiveStore.DayStart(cutoffDay), cancellationToken);
        }

        if (removed > 0)
        {
            await _store.IncrementalVacuumAsync(cancellationToken);
        }
        return removed;
    }

    private async Task<ArchiveSegment> ArchiveDayAsync(string day, CancellationToken cancellationToken)
    {
        var events = await _store.ReadDayAsync(day, cancellationToken);
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

            var verifiedCount = CountLines(tempPath);
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

    private static IReadOnlyList<Event> ReadSegmentFile(string path)
    {
        using var file = File.OpenRead(path);
        using var brotli = new BrotliStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(brotli, Encoding.UTF8);

        var events = new List<Event>();
        while (reader.ReadLine() is { } line)
        {
            if (line.Length == 0)
            {
                continue;
            }
            events.Add(JsonSerializer.Deserialize<Event>(line, LineOptions)
                ?? throw new ArchiveVerificationException($"{Path.GetFileName(path)}: null event line."));
        }
        return events;
    }

    private static long CountLines(string path)
    {
        using var file = File.OpenRead(path);
        using var brotli = new BrotliStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(brotli, Encoding.UTF8);

        long count = 0;
        while (reader.ReadLine() is { } line)
        {
            if (line.Length > 0)
            {
                count++;
            }
        }
        return count;
    }

    /// <summary>file_path is stored as a bare file name; strip any directories as defense in depth.</summary>
    private string SegmentPath(string filePath) =>
        Path.Combine(ArchiveDirectory, Path.GetFileName(filePath));

    private static string ToDay(DateTime date) => date.ToString("yyyy-MM-dd");
}
