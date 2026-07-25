using System.Text;
using System.Text.Json;
using LogHarbor.Core.Events;

namespace LogHarbor.Tests.Events;

public sealed class SeqRawEventsParserTests
{
    private static readonly DateTimeOffset ServerTime =
        new(2026, 7, 13, 12, 0, 0, TimeSpan.Zero);

    private static bool IsEnvelope(string body) =>
        SeqRawEventsParser.IsEnvelope(Encoding.UTF8.GetBytes(body));

    private static Event ParseFirst(string envelope)
    {
        using var document = JsonDocument.Parse(envelope);
        var element = document.RootElement.GetProperty(SeqRawEventsParser.EventsProperty)
            .EnumerateArray().First();
        Assert.True(SeqRawEventsParser.TryParseEvent(element, ServerTime, out var parsed, out var error), error);
        return parsed!;
    }

    private static string? ParseError(string eventJson)
    {
        using var document = JsonDocument.Parse(eventJson);
        Assert.False(SeqRawEventsParser.TryParseEvent(document.RootElement, ServerTime, out _, out var error));
        return error;
    }

    [Theory]
    [InlineData("""{"Events":[{"Timestamp":"2026-07-13T10:00:00Z"}]}""")]
    [InlineData("""{"Events":[]}""")]
    [InlineData("""{ "Events" : [ { "Timestamp" : "2026-07-13T10:00:00Z" } ] }""")]
    [InlineData("""{"Other":1,"Events":[{"Timestamp":"2026-07-13T10:00:00Z"}]}""")]
    public void IsEnvelope_RecognizesSeqRawEvents(string body)
    {
        Assert.True(IsEnvelope(body));
    }

    [Theory]
    [InlineData("")]
    [InlineData("""{"@t":"2026-07-13T10:00:00Z","@m":"one clef line"}""")]
    [InlineData("{\"@t\":\"2026-07-13T10:00:00Z\"}\n{\"@t\":\"2026-07-13T10:00:01Z\"}")]
    [InlineData("""[{"Timestamp":"2026-07-13T10:00:00Z"}]""")]
    [InlineData("""{"Events":{"not":"an array"}}""")]
    [InlineData("not json at all")]
    public void IsEnvelope_RejectsEverythingElse(string body)
    {
        Assert.False(IsEnvelope(body));
    }

    /// <summary>A CLEF event may carry its own "Events" property; @t settles which format it is.</summary>
    [Fact]
    public void IsEnvelope_False_ForClefLineCarryingAnEventsProperty()
    {
        Assert.False(IsEnvelope("""{"@t":"2026-07-13T10:00:00Z","Events":[1,2]}"""));
    }

    [Fact]
    public void Parses_AllSeqRawFields()
    {
        var parsed = ParseFirst(
            """
            {"Events":[{"Timestamp":"2026-07-13T10:00:00Z","Level":"Error",
            "MessageTemplate":"Order {OrderId} failed for {Customer}",
            "Exception":"System.Exception: boom",
            "Properties":{"OrderId":123,"Customer":"acme"}}]}
            """);

        Assert.Equal("2026-07-13T10:00:00.0000000Z", parsed.Timestamp);
        Assert.Equal("Error", parsed.Level);
        Assert.Equal("Order 123 failed for acme", parsed.Message);
        Assert.Equal("Order {OrderId} failed for {Customer}", parsed.MessageTemplate);
        Assert.Equal("System.Exception: boom", parsed.Exception);
        Assert.Equal("""{"OrderId":123,"Customer":"acme"}""", parsed.Properties);
        Assert.Equal("2026-07-13T12:00:00.0000000Z", parsed.IngestedAt);
    }

    [Fact]
    public void PreRenderedMessage_WinsOverTheTemplate()
    {
        var parsed = ParseFirst(
            """{"Events":[{"Timestamp":"2026-07-13T10:00:00Z","MessageTemplate":"Order {OrderId}","Message":"already rendered","Properties":{"OrderId":1}}]}""");

        Assert.Equal("already rendered", parsed.Message);
        Assert.Equal("Order {OrderId}", parsed.MessageTemplate);
    }

    [Fact]
    public void MissingProperties_LeaveTemplateTokensAndNullColumn()
    {
        var parsed = ParseFirst(
            """{"Events":[{"Timestamp":"2026-07-13T10:00:00Z","MessageTemplate":"Order {OrderId}"}]}""");

        Assert.Equal("Order {OrderId}", parsed.Message);
        Assert.Null(parsed.Properties);
    }

    [Theory]
    [InlineData("error", "Error")]      // winston-seq sends lowercase npm levels
    [InlineData("Critical", "Fatal")]   // seqlog maps Python CRITICAL to Seq's Critical
    [InlineData("warn", "Warning")]
    [InlineData(null, "Information")]
    public void Level_GoesThroughTheSharedAliasMap(string? level, string expected)
    {
        var levelJson = level is null ? "" : $""","Level":"{level}" """;
        var parsed = ParseFirst($$"""{"Events":[{"Timestamp":"2026-07-13T10:00:00Z"{{levelJson}}}]}""");

        Assert.Equal(expected, parsed.Level);
    }

    [Theory]
    [InlineData("2026-07-13T13:00:00+03:00", "2026-07-13T10:00:00.0000000Z")]
    [InlineData("2026-07-13T10:00:00.123Z", "2026-07-13T10:00:00.1230000Z")]
    [InlineData("2026-07-13T12:06:00Z", "2026-07-13T12:00:00.0000000Z")] // future clamp
    public void NormalizesTimestamp_LikeTheClefPath(string input, string expected)
    {
        var parsed = ParseFirst($$"""{"Events":[{"Timestamp":"{{input}}"}]}""");

        Assert.Equal(expected, parsed.Timestamp);
    }

    [Theory]
    [InlineData("""{"Level":"Error"}""")]
    [InlineData("""{"Timestamp":"not-a-date"}""")]
    [InlineData("""{"Timestamp":123}""")]
    public void MissingOrUnparseableTimestamp_IsRejected(string eventJson)
    {
        Assert.Contains("Timestamp", ParseError(eventJson));
    }

    [Fact]
    public void NonObjectEvent_IsRejected()
    {
        Assert.Contains("JSON object", ParseError("42"));
    }
}
