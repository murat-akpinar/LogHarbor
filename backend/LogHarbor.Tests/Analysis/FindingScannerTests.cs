using Microsoft.Extensions.DependencyInjection;
using LogHarbor.Core.Analysis;
using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;
using LogHarbor.Tests.Api;

namespace LogHarbor.Tests.Analysis;

/// <summary>
/// The four detectors, each against the shape it is supposed to catch and against the shape it is
/// supposed to stay quiet about. The gates matter as much as the detections: a findings layer that
/// cries wolf costs more than one that misses something, because the reader stops looking.
/// </summary>
public sealed class FindingScannerTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly IEventStore _events;
    private readonly FindingScanner _scanner;

    /// <summary>A one-hour window with four hours of baseline behind it, the scanner's own ratio.</summary>
    private static readonly DateTimeOffset To = new(2026, 8, 8, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset From = To.AddHours(-1);
    private static readonly DateTimeOffset BaselineStart = From.AddHours(-4);

    public FindingScannerTests()
    {
        _events = _factory.Services.GetRequiredService<IEventStore>();
        _scanner = new FindingScanner(_events);
    }

    public void Dispose() => _factory.Dispose();

    private Task<IReadOnlyList<Finding>> ScanAsync() =>
        _scanner.ScanAsync(From, To, "Path", "Method");

    private async Task WriteAsync(params Event[] events) => await _events.WriteBatchAsync(events);

    /// <summary>One event at <paramref name="when"/>; properties is raw JSON as stored.</summary>
    private static Event At(
        DateTimeOffset when, string level = "Information", string? properties = null,
        string? template = null, string? exception = null)
    {
        var ts = ClefParser.FormatTimestamp(when);
        return new Event(0, ts, level, template ?? "msg", template, properties, exception, ts);
    }

    /// <summary><paramref name="count"/> events spread evenly across [start, end).</summary>
    private static IEnumerable<Event> Spread(
        DateTimeOffset start, DateTimeOffset end, int count, string level = "Information",
        string? properties = null, string? template = null, string? exception = null)
    {
        var step = (end - start) / count;
        for (var i = 0; i < count; i++)
        {
            yield return At(start + step * i, level, properties, template, exception);
        }
    }

    private static string Service(string name) => $$"""{"Service":"{{name}}"}""";

    // --- went quiet ----------------------------------------------------------------------

    [Fact]
    public async Task AServiceThatStopsLogging_IsFound()
    {
        await WriteAsync([.. Spread(BaselineStart, From, 40, properties: Service("billing"))]);
        // something else keeps logging, so the window is not simply empty
        await WriteAsync([.. Spread(BaselineStart, To, 40, properties: Service("api"))]);

        var quiet = Assert.Single((await ScanAsync()).Where(f => f.Kind == FindingKinds.WentQuiet));

        Assert.Equal("billing", quiet.Subject);
        Assert.Equal(0, quiet.Now);
        Assert.Equal(10, quiet.Baseline);   // 40 across four windows
        Assert.Contains("billing", quiet.Filter);
    }

    [Fact]
    public async Task AServiceThatBarelyLogged_IsNotCalledQuiet()
    {
        // 8 across four windows is 2 a window: an empty window is within its own normal
        await WriteAsync([.. Spread(BaselineStart, From, 8, properties: Service("cron"))]);
        await WriteAsync([.. Spread(BaselineStart, To, 40, properties: Service("api"))]);

        Assert.DoesNotContain(await ScanAsync(), f => f.Kind == FindingKinds.WentQuiet);
    }

    [Fact]
    public async Task AServiceStillLogging_IsNotCalledQuiet()
    {
        await WriteAsync([.. Spread(BaselineStart, To, 60, properties: Service("billing"))]);

        Assert.DoesNotContain(await ScanAsync(), f => f.Kind == FindingKinds.WentQuiet);
    }

    // --- new exception -------------------------------------------------------------------

    [Fact]
    public async Task AnExceptionTypeNeverSeenBefore_IsFound()
    {
        await WriteAsync([.. Spread(BaselineStart, From, 5, "Error",
            exception: "System.TimeoutException: took too long\n  at Old.Code()")]);
        await WriteAsync([.. Spread(From, To, 3, "Error",
            exception: "Acme.Checkout.CartEmptyException: no items\n  at Cart.Check()")]);

        var found = Assert.Single((await ScanAsync()).Where(f => f.Kind == FindingKinds.NewException));

        Assert.Equal("Acme.Checkout.CartEmptyException", found.Subject);
        Assert.Equal(3, found.Count);
        Assert.Contains("Acme.Checkout.CartEmptyException", found.Filter);
    }

    [Fact]
    public async Task AnExceptionTypeSeenBefore_IsNotNew()
    {
        await WriteAsync([.. Spread(BaselineStart, From, 5, "Error",
            exception: "System.TimeoutException: took too long")]);
        await WriteAsync([.. Spread(From, To, 3, "Error",
            exception: "System.TimeoutException: took too long")]);

        Assert.DoesNotContain(await ScanAsync(), f => f.Kind == FindingKinds.NewException);
    }

    // day one: the whole history is inside the window, so nothing has a "before" to be new against
    [Fact]
    public async Task OnAnInstallWithNoHistory_NothingIsNew()
    {
        await WriteAsync([.. Spread(From, To, 4, "Error", exception: "System.Exception: first ever")]);

        Assert.DoesNotContain(await ScanAsync(), f => f.Kind == FindingKinds.NewException);
    }

    // the store's range is inclusive at both ends, so a baseline ending at `from` and a window
    // starting at `from` share that instant. An exception whose only earlier occurrence IS the
    // window's first event was therefore already "known" and never reported — and a round range
    // start (every preset the reader can pick) is exactly where events land.
    [Fact]
    public async Task AnExceptionStampedExactlyOnTheRangeStart_IsStillNew()
    {
        await WriteAsync(At(BaselineStart.AddMinutes(30), "Error", exception: "System.TimeoutException: old news"));
        await WriteAsync(At(From, "Error", exception: "Acme.Checkout.CartEmptyException: right on the boundary"));

        var found = Assert.Single((await ScanAsync()).Where(f => f.Kind == FindingKinds.NewException));

        Assert.Equal("Acme.Checkout.CartEmptyException", found.Subject);
    }

    // --- failing route -------------------------------------------------------------------

    private static string Request(string path, int status) =>
        $$"""{"Path":"{{path}}","Method":"GET","StatusCode":{{status}}}""";

    /// <summary>A route with <paramref name="failed"/> of <paramref name="total"/> requests failing.</summary>
    private IEnumerable<Event> Route(
        DateTimeOffset start, DateTimeOffset end, string path, int total, int failed)
    {
        var step = (end - start) / total;
        for (var i = 0; i < total; i++)
        {
            var ok = i >= failed;
            yield return At(start + step * i, ok ? "Information" : "Error",
                Request(path, ok ? 200 : 500), "HTTP {Method} {Path} responded {StatusCode}");
        }
    }

    [Fact]
    public async Task ARouteThatStartsFailing_IsFound()
    {
        await WriteAsync([.. Route(BaselineStart, From, "/api/checkout", 100, 0)]);
        await WriteAsync([.. Route(From, To, "/api/checkout", 40, 12)]);

        var found = Assert.Single((await ScanAsync()).Where(f => f.Kind == FindingKinds.FailingRoute));

        Assert.Equal(30, found.Now);        // 12 of 40
        Assert.Equal(0, found.Baseline);
        Assert.Equal(12, found.Count);
        Assert.Contains("/api/checkout", found.Filter);
    }

    [Fact]
    public async Task ARouteThatAlwaysFailedAtTheSameRate_IsNotFound()
    {
        await WriteAsync([.. Route(BaselineStart, From, "/api/flaky", 100, 30)]);
        await WriteAsync([.. Route(From, To, "/api/flaky", 40, 13)]);   // 32.5% vs 30%

        Assert.DoesNotContain(await ScanAsync(), f => f.Kind == FindingKinds.FailingRoute);
    }

    // a route that doubles its traffic doubles its errors with nothing wrong; a share does not move
    [Fact]
    public async Task ARouteWhoseTrafficGrew_IsNotCalledFailing()
    {
        await WriteAsync([.. Route(BaselineStart, From, "/api/orders", 100, 10)]);
        await WriteAsync([.. Route(From, To, "/api/orders", 80, 8)]);

        Assert.DoesNotContain(await ScanAsync(), f => f.Kind == FindingKinds.FailingRoute);
    }

    [Fact]
    public async Task ARouteWithTooFewRequests_IsNotFound()
    {
        await WriteAsync([.. Route(BaselineStart, From, "/api/rare", 100, 0)]);
        await WriteAsync([.. Route(From, To, "/api/rare", 6, 6)]);   // all failed, but only six

        Assert.DoesNotContain(await ScanAsync(), f => f.Kind == FindingKinds.FailingRoute);
    }

    // --- slower than usual ---------------------------------------------------------------

    private static string Elapsed(int ms) => $$"""{"Elapsed":{{ms}}}""";

    [Fact]
    public async Task AnOperationSlowerThanItsOwnBaseline_IsFound()
    {
        const string template = "DB query {Query} took {Elapsed} ms";
        await WriteAsync([.. Spread(BaselineStart, From, 40, properties: Elapsed(2000), template: template)]);
        await WriteAsync([.. Spread(From, To, 40, properties: Elapsed(6000), template: template)]);

        var found = Assert.Single((await ScanAsync()).Where(f => f.Kind == FindingKinds.SlowerThanUsual));

        Assert.Equal(template, found.Subject);
        Assert.Equal(2000, found.Baseline);
        Assert.Equal(6000, found.Now);
        Assert.Contains(template, found.Filter);
    }

    // the whole reason this repeats slow-operations instead of linking to it: with the Analysis
    // page's "everything older than the range" baseline, an operation younger than the range has
    // an empty one and can never be flagged at any threshold
    [Fact]
    public async Task AnOperationYoungerThanTheAnalysisBaseline_IsStillFound()
    {
        const string template = "New service {Query} took {Elapsed} ms";
        // nothing at all before the trailing baseline — the operation was deployed two hours ago
        await WriteAsync([.. Spread(From.AddHours(-2), From, 40, properties: Elapsed(100), template: template)]);
        await WriteAsync([.. Spread(From, To, 40, properties: Elapsed(400), template: template)]);

        Assert.Contains(await ScanAsync(), f => f.Kind == FindingKinds.SlowerThanUsual && f.Subject == template);
    }

    [Fact]
    public async Task AnOperationHoldingItsBaseline_IsNotFound()
    {
        const string template = "DB query {Query} took {Elapsed} ms";
        await WriteAsync([.. Spread(BaselineStart, From, 40, properties: Elapsed(2000), template: template)]);
        await WriteAsync([.. Spread(From, To, 40, properties: Elapsed(2100), template: template)]);

        Assert.DoesNotContain(await ScanAsync(), f => f.Kind == FindingKinds.SlowerThanUsual);
    }

    // --- the layer as a whole -------------------------------------------------------------

    [Fact]
    public async Task AnEmptyServer_FindsNothing()
    {
        Assert.Empty(await ScanAsync());
    }

    [Fact]
    public async Task SilenceOutranksEverythingElse()
    {
        const string template = "DB query {Query} took {Elapsed} ms";
        await WriteAsync([.. Spread(BaselineStart, From, 40, properties: Elapsed(2000), template: template)]);
        await WriteAsync([.. Spread(From, To, 40, properties: Elapsed(9000), template: template)]);
        await WriteAsync([.. Spread(BaselineStart, From, 40, properties: Service("billing"))]);
        await WriteAsync([.. Spread(BaselineStart, To, 40, properties: Service("api"))]);

        var findings = await ScanAsync();

        Assert.Equal(FindingKinds.WentQuiet, findings[0].Kind);
        Assert.Contains(findings, f => f.Kind == FindingKinds.SlowerThanUsual);
    }
}
