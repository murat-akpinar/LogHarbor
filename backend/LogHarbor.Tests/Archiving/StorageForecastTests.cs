using LogHarbor.Core.Archiving;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Archiving;

public sealed class StorageForecastTests
{
    private const long Megabyte = 1024 * 1024;

    private static readonly DateTimeOffset Start = new(2026, 7, 20, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void TooFewReadings_Measures_RatherThanGuessing()
    {
        var samples = Series(hours: 1, count: 3, startBytes: 10 * Megabyte, perHour: Megabyte);

        var forecast = StorageForecast.Estimate(samples, 13 * Megabyte, 100 * Megabyte, "2026-07-20");

        Assert.Equal(StorageForecast.Measuring, forecast.Status);
        Assert.Null(forecast.DailyGrowthBytes);
        Assert.Null(forecast.DaysUntilFull);
    }

    [Fact]
    public void ReadingsTooCloseTogether_Measures_EvenWhenThereAreEnoughOfThem()
    {
        // ten readings a minute apart is ten minutes of evidence, not a trend
        var samples = Series(hours: 1 / 60d, count: 10, startBytes: 10 * Megabyte, perHour: Megabyte);

        var forecast = StorageForecast.Estimate(samples, 10 * Megabyte, 0, null);

        Assert.Equal(StorageForecast.Measuring, forecast.Status);
    }

    [Fact]
    public void SteadyGrowth_IsReportedPerDay()
    {
        var samples = Series(hours: 1, count: 24, startBytes: 10 * Megabyte, perHour: Megabyte);

        var forecast = StorageForecast.Estimate(samples, 33 * Megabyte, 0, "2026-07-20");

        Assert.Equal(StorageForecast.Growing, forecast.Status);
        Assert.Equal(24 * Megabyte, forecast.DailyGrowthBytes);
        Assert.Null(forecast.DaysUntilFull); // no ceiling configured, so there is nothing to fill
    }

    [Fact]
    public void WithACeiling_SaysHowManyDaysAreLeft()
    {
        var samples = Series(hours: 1, count: 24, startBytes: 10 * Megabyte, perHour: Megabyte);

        var forecast = StorageForecast.Estimate(samples, 100 * Megabyte, 340 * Megabyte, "2026-07-20");

        Assert.Equal(StorageForecast.Growing, forecast.Status);
        Assert.Equal(10, forecast.DaysUntilFull); // 240 MB of room at 24 MB/day
    }

    [Fact]
    public void AFlatFile_IsSteady_NotADateFarInTheFuture()
    {
        var samples = Series(hours: 1, count: 24, startBytes: 40 * Megabyte, perHour: 0);

        var forecast = StorageForecast.Estimate(samples, 40 * Megabyte, 100 * Megabyte, "2026-07-20");

        Assert.Equal(StorageForecast.Steady, forecast.Status);
        Assert.Null(forecast.DaysUntilFull);
    }

    [Fact]
    public void AShrinkingFile_IsSteadyToo_NeverANegativeCountdown()
    {
        var samples = Series(hours: 1, count: 24, startBytes: 80 * Megabyte, perHour: -Megabyte);

        var forecast = StorageForecast.Estimate(samples, 56 * Megabyte, 100 * Megabyte, "2026-07-20");

        Assert.Equal(StorageForecast.Steady, forecast.Status);
        Assert.Null(forecast.DaysUntilFull);
    }

    [Fact]
    public void AtTheCeiling_SaysSo_AndNamesTheDayThatGoesFirst()
    {
        var samples = Series(hours: 1, count: 24, startBytes: 95 * Megabyte, perHour: Megabyte);

        var forecast = StorageForecast.Estimate(samples, 100 * Megabyte, 100 * Megabyte, "2026-07-19");

        Assert.Equal(StorageForecast.AtCeiling, forecast.Status);
        Assert.Equal(0, forecast.DaysUntilFull);
        Assert.Equal("2026-07-19", forecast.OldestDay);
    }

    [Fact]
    public void OneMaintenanceCutback_DoesNotEraseTheTrend()
    {
        // the size cap or the daily archive pass drops a day in the middle of the window; a
        // last-minus-first slope would read that as no growth at all
        var samples = new List<DatabaseSizeSample>();
        for (var hour = 0; hour < 12; hour++)
        {
            samples.Add(Sample(hour, (40 + hour) * Megabyte));
        }
        for (var hour = 12; hour < 24; hour++)
        {
            samples.Add(Sample(hour, (40 + hour - 8) * Megabyte));
        }

        var forecast = StorageForecast.Estimate(samples, 56 * Megabyte, 0, "2026-07-20");

        Assert.Equal(StorageForecast.Growing, forecast.Status);
        Assert.True(forecast.DailyGrowthBytes > 0);
    }

    [Fact]
    public void ObservedHours_CoversTheWholeWindow()
    {
        var samples = Series(hours: 1, count: 24, startBytes: 10 * Megabyte, perHour: Megabyte);

        var forecast = StorageForecast.Estimate(samples, 33 * Megabyte, 0, null);

        Assert.Equal(23, forecast.ObservedHours, precision: 3);
        Assert.Equal(24, forecast.SampleCount);
    }

    private static List<DatabaseSizeSample> Series(double hours, int count, long startBytes, long perHour)
    {
        var samples = new List<DatabaseSizeSample>();
        for (var i = 0; i < count; i++)
        {
            samples.Add(new DatabaseSizeSample(
                ClefParser.FormatTimestamp(Start.AddHours(hours * i)),
                startBytes + (long)(perHour * hours * i)));
        }
        return samples;
    }

    private static DatabaseSizeSample Sample(int hour, long bytes) =>
        new(ClefParser.FormatTimestamp(Start.AddHours(hour)), bytes);
}
