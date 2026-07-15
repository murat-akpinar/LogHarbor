using LogHarbor.Core.Events;

namespace LogHarbor.Tests.Events;

public sealed class ClefParserTests
{
    private static readonly DateTimeOffset ServerTime =
        new(2026, 7, 13, 12, 0, 0, TimeSpan.Zero);

    private static Event Parse(string line)
    {
        Assert.True(ClefParser.TryParse(line, ServerTime, out var parsed, out var error), error);
        return parsed!;
    }

    [Fact]
    public void Parses_AllClefFields()
    {
        var parsed = Parse(
            """{"@t":"2026-07-13T10:00:00Z","@l":"Error","@m":"Order 42 failed","@mt":"Order {OrderId} failed","@x":"System.Exception: boom","OrderId":42}""");

        Assert.Equal("2026-07-13T10:00:00.0000000Z", parsed.Timestamp);
        Assert.Equal("Error", parsed.Level);
        Assert.Equal("Order 42 failed", parsed.Message);
        Assert.Equal("Order {OrderId} failed", parsed.MessageTemplate);
        Assert.Equal("System.Exception: boom", parsed.Exception);
        Assert.Equal("""{"OrderId":42}""", parsed.Properties);
        Assert.Equal("2026-07-13T12:00:00.0000000Z", parsed.IngestedAt);
    }

    [Theory]
    [InlineData("2026-07-13T13:00:00+03:00", "2026-07-13T10:00:00.0000000Z")] // offset -> UTC
    [InlineData("2026-07-13T10:00:00.123Z", "2026-07-13T10:00:00.1230000Z")] // precision padded
    [InlineData("2026-07-13T10:00:00", "2026-07-13T10:00:00.0000000Z")] // no zone -> assume UTC
    public void NormalizesTimestamp_ToFixedUtcFormat(string input, string expected)
    {
        Assert.Equal(expected, Parse($$"""{"@t":"{{input}}"}""").Timestamp);
    }

    [Fact]
    public void FutureTimestamp_BeyondTolerance_IsClampedToServerTime()
    {
        var parsed = Parse("""{"@t":"2026-07-13T12:06:00Z"}""");
        Assert.Equal("2026-07-13T12:00:00.0000000Z", parsed.Timestamp);
    }

    [Fact]
    public void FutureTimestamp_WithinTolerance_IsKept()
    {
        var parsed = Parse("""{"@t":"2026-07-13T12:04:00Z"}""");
        Assert.Equal("2026-07-13T12:04:00.0000000Z", parsed.Timestamp);
    }

    [Theory]
    [InlineData("""{"no_t":true}""")]
    [InlineData("""{"@t":"not-a-date"}""")]
    [InlineData("""{"@t":123}""")]
    public void MissingOrUnparseableTimestamp_IsRejected(string line)
    {
        Assert.False(ClefParser.TryParse(line, ServerTime, out _, out var error));
        Assert.Contains("@t", error);
    }

    [Theory]
    [InlineData("not json at all")]
    [InlineData("[1,2,3]")]
    public void InvalidLine_IsRejected(string line)
    {
        Assert.False(ClefParser.TryParse(line, ServerTime, out _, out _));
    }

    [Theory]
    [InlineData("trace", "Verbose")]
    [InlineData("Verbose", "Verbose")]
    [InlineData("debug", "Debug")]
    [InlineData("info", "Information")]
    [InlineData("WARN", "Warning")]
    [InlineData("Warning", "Warning")]
    [InlineData("err", "Error")]
    [InlineData("critical", "Fatal")]
    [InlineData("crit", "Fatal")]
    [InlineData("Fatal", "Fatal")]
    [InlineData("something-weird", "Information")]
    public void MapsLevelAliases_CaseInsensitively(string input, string expected)
    {
        Assert.Equal(expected, Parse($$"""{"@t":"2026-07-13T10:00:00Z","@l":"{{input}}"}""").Level);
    }

    [Fact]
    public void MissingLevel_DefaultsToInformation()
    {
        Assert.Equal("Information", Parse("""{"@t":"2026-07-13T10:00:00Z"}""").Level);
    }

    [Fact]
    public void MissingMessage_IsRenderedFromTemplate()
    {
        var parsed = Parse(
            """{"@t":"2026-07-13T10:00:00Z","@mt":"User {UserId} took {Elapsed:0.00} ms","UserId":"alice","Elapsed":12.5}""");
        Assert.Equal("User alice took 12.5 ms", parsed.Message);
    }

    [Fact]
    public void TemplateToken_WithoutMatchingProperty_IsLeftAsIs()
    {
        var parsed = Parse("""{"@t":"2026-07-13T10:00:00Z","@mt":"Hello {Nobody}"}""");
        Assert.Equal("Hello {Nobody}", parsed.Message);
    }

    [Fact]
    public void AtPrefixedKeys_AreExcludedFromProperties()
    {
        var parsed = Parse("""{"@t":"2026-07-13T10:00:00Z","@i":"abc123","UserId":7,"Tags":["a","b"]}""");
        Assert.Equal("""{"UserId":7,"Tags":["a","b"]}""", parsed.Properties);
    }

    [Fact]
    public void NoProperties_YieldsNull()
    {
        Assert.Null(Parse("""{"@t":"2026-07-13T10:00:00Z","@m":"hi"}""").Properties);
    }
}
