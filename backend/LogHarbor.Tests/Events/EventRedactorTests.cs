using System.Text.Json;
using LogHarbor.Core.Events;

namespace LogHarbor.Tests.Events;

public class EventRedactorTests
{
    private static Event Make(string? properties, string message = "hello", string? template = null) =>
        new(0, "2026-08-07T10:00:00.0000000Z", "Information", message, template, properties, null,
            "2026-08-07T10:00:00.0000000Z");

    private static string Property(Event stored, string path)
    {
        using var document = JsonDocument.Parse(stored.Properties!);
        var element = document.RootElement;
        foreach (var step in path.Split('.'))
        {
            element = int.TryParse(step, out var index) ? element[index] : element.GetProperty(step);
        }
        return element.ToString();
    }

    /// <summary>The shipped state: an empty list is the whole feature switched off, and an
    /// event must come out of it byte for byte the same object.</summary>
    [Fact]
    public void EmptyList_LeavesTheEventAlone()
    {
        var source = Make("""{"Password":"hunter2"}""");

        Assert.Same(source, EventRedactor.Apply(source, []));
    }

    [Fact]
    public void NoMatch_LeavesTheEventAlone()
    {
        var source = Make("""{"OrderId":42}""");

        Assert.Same(source, EventRedactor.Apply(source, ["password"]));
    }

    /// <summary>The value goes, the key stays: "this request carried no Authorization header"
    /// and "it did, and we refused to keep it" are different facts and a missing key tells the
    /// wrong one.</summary>
    [Fact]
    public void ReplacesTheValueAndKeepsTheKey()
    {
        var stored = EventRedactor.Apply(Make("""{"Password":"hunter2","OrderId":42}"""), ["password"]);

        Assert.Equal(EventRedactor.Placeholder, Property(stored, "Password"));
        Assert.Equal("42", Property(stored, "OrderId"));
    }

    /// <summary>Fragments, not names — which is what makes a short list worth keeping. A sink
    /// writes AccessToken, another writes x-csrf-token, and "token" is meant to cover both.</summary>
    [Theory]
    [InlineData("AccessToken")]
    [InlineData("refresh_token")]
    [InlineData("X-Csrf-Token")]
    [InlineData("TOKEN")]
    public void MatchesNameFragmentsCaseInsensitively(string name)
    {
        var stored = EventRedactor.Apply(Make($$"""{"{{name}}":"secret"}"""), ["token"]);

        Assert.Equal(EventRedactor.Placeholder, Property(stored, name));
    }

    /// <summary>A property bag is a tree — an Authorization header sits two levels down inside
    /// the request object, which is exactly where a middleware puts it.</summary>
    [Fact]
    public void ReachesIntoNestedObjectsAndArrays()
    {
        var source = Make("""
            {"Request":{"Headers":{"Authorization":"Bearer abc","Accept":"application/json"}},
             "Attempts":[{"Password":"one"},{"Password":"two"}]}
            """);

        var stored = EventRedactor.Apply(source, ["authorization", "password"]);

        Assert.Equal(EventRedactor.Placeholder, Property(stored, "Request.Headers.Authorization"));
        Assert.Equal("application/json", Property(stored, "Request.Headers.Accept"));
        Assert.Equal(EventRedactor.Placeholder, Property(stored, "Attempts.0.Password"));
        Assert.Equal(EventRedactor.Placeholder, Property(stored, "Attempts.1.Password"));
    }

    /// <summary>A whole object under a matching name goes as one, rather than being walked into
    /// and left as a shape with redacted leaves.</summary>
    [Fact]
    public void ReplacesAWholeMatchingSubtree()
    {
        var stored = EventRedactor.Apply(
            Make("""{"Credentials":{"User":"ada","Password":"hunter2"}}"""), ["credentials"]);

        Assert.Equal(EventRedactor.Placeholder, Property(stored, "Credentials"));
    }

    /// <summary>The message is the properties spelled into a sentence. Redacting the bag and
    /// leaving the secret on the row hides it from the property tree and from nowhere else.</summary>
    [Fact]
    public void RendersTheMessageAgainWithoutTheSecret()
    {
        var source = Make("""{"User":"ada","Password":"hunter2"}""",
            message: "Signed in as ada with hunter2", template: "Signed in as {User} with {Password}");

        var stored = EventRedactor.Apply(source, ["password"]);

        Assert.Equal($"Signed in as ada with {EventRedactor.Placeholder}", stored.Message);
    }

    /// <summary>A CLEF event can arrive already rendered, with no template to render again from,
    /// so that message is edited as text instead.</summary>
    [Fact]
    public void ScrubsAPreRenderedMessage()
    {
        var source = Make("""{"Password":"hunter2"}""", message: "Signed in with hunter2");

        var stored = EventRedactor.Apply(source, ["password"]);

        Assert.Equal($"Signed in with {EventRedactor.Placeholder}", stored.Message);
    }

    /// <summary>A message that never mentioned the value is not touched — including the case
    /// where re-rendering the template would have changed how the sender formatted it.</summary>
    [Fact]
    public void LeavesAMessageThatDoesNotLeakAlone()
    {
        var source = Make("""{"Password":"hunter2"}""",
            message: "Sign-in attempt from 10.0.0.4", template: "Sign-in attempt from {Ip}");

        var stored = EventRedactor.Apply(source, ["password"]);

        Assert.Equal("Sign-in attempt from 10.0.0.4", stored.Message);
    }

    /// <summary>Two characters cannot be told from ordinary text by substring search: blanking
    /// every "42" in a sentence damages the line to hide something the property already shows
    /// as redacted. Templated events do not go through this path and are exact either way.</summary>
    [Fact]
    public void DoesNotScrubAVeryShortValueOutOfAPreRenderedMessage()
    {
        var source = Make("""{"Pin":42}""", message: "Order 42 paid, 42 items");

        var stored = EventRedactor.Apply(source, ["pin"]);

        Assert.Equal(EventRedactor.Placeholder, Property(stored, "Pin"));
        Assert.Equal("Order 42 paid, 42 items", stored.Message);
    }

    /// <summary>Numbers and objects reach a rendered message as text too, so both have to be
    /// recognised there — a redacted card number is the ordinary case.</summary>
    [Fact]
    public void ScrubsANumericValueOutOfAPreRenderedMessage()
    {
        var source = Make("""{"CardNumber":4111111111111111}""",
            message: "Charged card 4111111111111111");

        var stored = EventRedactor.Apply(source, ["cardnumber"]);

        Assert.Equal($"Charged card {EventRedactor.Placeholder}", stored.Message);
    }

    /// <summary>Applying it twice must not stack placeholders or count a redaction that already
    /// happened as a fresh one — hydration re-reads stored rows.</summary>
    [Fact]
    public void IsIdempotent()
    {
        var once = EventRedactor.Apply(Make("""{"Password":"hunter2"}"""), ["password"]);
        var twice = EventRedactor.Apply(once, ["password"]);

        Assert.Equal(EventRedactor.Placeholder, Property(twice, "Password"));
        Assert.Same(once, twice);
    }

    [Fact]
    public void LeavesAnEventWithNoPropertiesAlone()
    {
        var source = Make(null);

        Assert.Same(source, EventRedactor.Apply(source, ["password"]));
    }
}
