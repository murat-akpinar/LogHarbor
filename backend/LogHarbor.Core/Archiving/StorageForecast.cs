using System.Globalization;
using LogHarbor.Core.Storage;

namespace LogHarbor.Core.Archiving;

/// <summary>What the recorded database sizes say about where the file is heading.</summary>
/// <param name="Status">
/// measuring — not enough history yet; growth is null.
/// steady — measured, but flat or shrinking, so there is no date to give.
/// growing — measured and rising; DaysUntilFull is set when a ceiling is configured.
/// at-ceiling — already at or over MaxDatabaseBytes, so the size cap is dropping days now.
/// </param>
public sealed record StorageForecast(
    long DatabaseBytes,
    long MaxDatabaseBytes,
    int SampleCount,
    double ObservedHours,
    long? DailyGrowthBytes,
    double? DaysUntilFull,
    string? OldestDay,
    string Status)
{
    public const string Measuring = "measuring";
    public const string Steady = "steady";
    public const string Growing = "growing";
    public const string AtCeiling = "at-ceiling";

    /// <summary>Two readings an hour apart can differ by one checkpoint and nothing else.
    /// Four spanning three hours is still a small claim, but it is a trend rather than noise.</summary>
    public const int MinimumSamples = 4;

    public const double MinimumObservedHours = 3;

    /// <remarks>
    /// A least-squares fit over the readings, not last-minus-first: the size cap and the daily
    /// archive pass both cut the file back, so a window that happens to start or end next to
    /// one of those steps would report a slope the disk never had.
    ///
    /// A flat or falling fit is reported as steady rather than as a negative growth rate. The
    /// question this answers is when the disk runs out, and "never, at this rate" is the whole
    /// answer — extrapolating a shrink backwards into a date would be arithmetic, not evidence.
    /// </remarks>
    public static StorageForecast Estimate(
        IReadOnlyList<DatabaseSizeSample> samples,
        long databaseBytes,
        long maxDatabaseBytes,
        string? oldestDay)
    {
        var observedHours = ObservedHoursOf(samples);
        var slopeBytesPerHour = samples.Count >= MinimumSamples && observedHours >= MinimumObservedHours
            ? SlopeBytesPerHour(samples)
            : null;

        if (slopeBytesPerHour is null)
        {
            return new StorageForecast(
                databaseBytes, maxDatabaseBytes, samples.Count, observedHours,
                DailyGrowthBytes: null, DaysUntilFull: null, oldestDay, Measuring);
        }

        var dailyGrowth = (long)Math.Round(slopeBytesPerHour.Value * 24);
        var capped = maxDatabaseBytes > 0;

        if (capped && databaseBytes >= maxDatabaseBytes)
        {
            return new StorageForecast(
                databaseBytes, maxDatabaseBytes, samples.Count, observedHours,
                dailyGrowth, DaysUntilFull: 0, oldestDay, AtCeiling);
        }
        if (dailyGrowth <= 0)
        {
            return new StorageForecast(
                databaseBytes, maxDatabaseBytes, samples.Count, observedHours,
                dailyGrowth, DaysUntilFull: null, oldestDay, Steady);
        }

        var daysUntilFull = capped
            ? Math.Round((double)(maxDatabaseBytes - databaseBytes) / dailyGrowth, 1)
            : (double?)null;
        return new StorageForecast(
            databaseBytes, maxDatabaseBytes, samples.Count, observedHours,
            dailyGrowth, daysUntilFull, oldestDay, Growing);
    }

    private static double ObservedHoursOf(IReadOnlyList<DatabaseSizeSample> samples)
    {
        if (samples.Count < 2)
        {
            return 0;
        }
        return (ParseHours(samples[^1].TakenAt) - ParseHours(samples[0].TakenAt)) / 3600;
    }

    private static double? SlopeBytesPerHour(IReadOnlyList<DatabaseSizeSample> samples)
    {
        var hours = samples.Select(sample => ParseHours(sample.TakenAt) / 3600).ToArray();
        var meanHour = hours.Average();
        var meanSize = samples.Average(sample => (double)sample.SizeBytes);

        double covariance = 0;
        double variance = 0;
        for (var i = 0; i < samples.Count; i++)
        {
            var deltaHour = hours[i] - meanHour;
            covariance += deltaHour * (samples[i].SizeBytes - meanSize);
            variance += deltaHour * deltaHour;
        }
        return variance > 0 ? covariance / variance : null;
    }

    /// <summary>Seconds since the epoch; the caller divides. Stored timestamps are UTC
    /// ISO-8601 (rules.md), and an unparseable one is treated as the epoch rather than
    /// throwing — a bad row must not take the whole Settings page down.</summary>
    private static double ParseHours(string timestamp) =>
        DateTimeOffset.TryParse(
            timestamp, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed)
            ? parsed.ToUnixTimeMilliseconds() / 1000d
            : 0;
}
