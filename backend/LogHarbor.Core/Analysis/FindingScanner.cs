using LogHarbor.Core.Events;
using LogHarbor.Core.Storage;

namespace LogHarbor.Core.Analysis;

/// <summary>
/// Four detectors over data the server already stores, run against the range the reader is
/// looking at. None of them needs a rule, a threshold or any new instrumentation: every number
/// they compare comes out of the same aggregation queries the stats pages are built from.
///
/// <para>Nothing is written down. Storing findings would buy deduplication and dismissal, and
/// both only matter for something that interrupts you — a silent layer recomputed per read is
/// always consistent with the range picker above it, and costs a schema, a scanner, an expiry
/// policy and a dedupe key less.</para>
/// </summary>
public sealed class FindingScanner
{
    /// <summary>How much history each rate is judged against, as a multiple of the window itself.
    /// Four is enough for the comparison to mean something without reaching back so far that a
    /// deploy last week still counts as normal.</summary>
    public const int BaselineWindows = 4;

    /// <summary>Events before this predate any server, so it stands in for "all of history".
    /// Only the new-exception detector wants it: a crash last seen three months ago is not new,
    /// however quiet the last four windows were.</summary>
    private const string AllHistory = "2000-01-01T00:00:00.0000000Z";

    /// <summary>Groups to pull per query. The same ponytail the Analysis page has: a type beyond
    /// the baseline's top N reads as new. Generous enough that it takes a genuinely long tail.</summary>
    private const int GroupLimit = 100;

    /// <summary>Findings returned. More than this on one screen is not a shortlist any more.</summary>
    private const int MaxFindings = 12;

    // --- gates, all of them there to stop a detector shouting about three events ---

    /// <summary>A service has to have been logging at least this often per window before its
    /// silence means anything. Below it, "nothing this window" is just how quiet it always was.</summary>
    private const long QuietMinBaselineRate = 5;

    /// <summary>A route needs this many requests in each window before its failure rate is a rate
    /// rather than an accident.</summary>
    private const long RouteMinRequests = 20;

    /// <summary>And its failure share has to climb by this many percentage points. A route that
    /// went from 40% to 44% failed is not news; one that went from 0% to 12% is.</summary>
    private const double RouteMinRise = 5;

    /// <summary>Latency regression is the existing slow-operations test, at its own defaults.</summary>
    private const int SlowMinSamples = 20;
    private const double SlowFloorMs = 50;
    private const double SlowFactor = 2;

    private readonly IEventStore _events;

    public FindingScanner(IEventStore events) => _events = events;

    /// <summary>
    /// Everything worth a look in [from, to), most alarming first. Ordered by kind before
    /// magnitude on purpose: a service that stopped logging outranks any amount of slow, because
    /// silence is the one thing the reader cannot discover by looking harder at what is there.
    /// </summary>
    public async Task<IReadOnlyList<Finding>> ScanAsync(
        DateTimeOffset from, DateTimeOffset to, string routeProperty, string methodProperty,
        CancellationToken cancellationToken = default)
    {
        var span = to - from;
        var baselineFrom = from - span * BaselineWindows;

        var fromUtc = ClefParser.FormatTimestamp(from);
        var toUtc = ClefParser.FormatTimestamp(to);
        var baselineFromUtc = ClefParser.FormatTimestamp(baselineFrom);
        // the store's range is inclusive at both ends, so a baseline ending at `from` shares its
        // last instant with the window. One tick back — the smallest step the timestamp format can
        // represent — is what keeps an event stamped exactly on a round range start from being
        // counted as both the news and the history that disproves it.
        var baselineToUtc = ClefParser.FormatTimestamp(from.AddTicks(-1));

        var findings = new List<Finding>();
        findings.AddRange(await WentQuietAsync(baselineFromUtc, baselineToUtc, fromUtc, toUtc, cancellationToken));
        findings.AddRange(await NewExceptionsAsync(baselineToUtc, fromUtc, toUtc, cancellationToken));
        findings.AddRange(await FailingRoutesAsync(
            baselineFromUtc, baselineToUtc, fromUtc, toUtc, routeProperty, methodProperty, cancellationToken));
        findings.AddRange(await SlowerThanUsualAsync(
            from, to, baselineFromUtc, fromUtc, toUtc, routeProperty, methodProperty, cancellationToken));

        return findings
            .OrderBy(finding => Array.IndexOf(FindingKinds.ByUrgency, finding.Kind))
            .ThenByDescending(Magnitude)
            .Take(MaxFindings)
            .ToList();
    }

    /// <summary>How far past normal a finding is, for ordering within its kind. A new exception
    /// has no "normal" to be past, so its own count is the only thing that ranks it.</summary>
    private static double Magnitude(Finding finding) => finding.Kind switch
    {
        FindingKinds.WentQuiet => finding.Baseline,
        FindingKinds.NewException => finding.Count,
        _ => finding.Baseline > 0 ? finding.Now / finding.Baseline : finding.Now,
    };

    /// <summary>
    /// A service that was logging steadily across the baseline and logged nothing at all in the
    /// window. This is the detector no hand-written rule replaces: an alert rule counts what
    /// arrived and fires when there is too much of it, so the one shape it structurally cannot
    /// express is "and this one sent nothing". The `silence` alert condition can, but only for a
    /// filter somebody already thought to write — this asks it of every service at once.
    /// </summary>
    private async Task<IEnumerable<Finding>> WentQuietAsync(
        string baselineFromUtc, string baselineToUtc, string fromUtc, string toUtc,
        CancellationToken cancellationToken)
    {
        var baseline = await _events.GetServiceOverviewAsync(
            null, baselineFromUtc, baselineToUtc, GroupLimit, cancellationToken);
        if (baseline.Count == 0)
        {
            return [];
        }
        var window = await _events.GetServiceOverviewAsync(null, fromUtc, toUtc, GroupLimit, cancellationToken);
        var alive = window.Where(service => service.Total > 0).Select(service => service.Service).ToHashSet();

        return baseline
            .Where(service => !alive.Contains(service.Service))
            // the baseline covers BaselineWindows windows, so its own per-window rate is what the
            // window should have seen — comparing raw totals would gate on the wrong number
            .Select(service => (service, rate: (double)service.Total / BaselineWindows))
            .Where(pair => pair.rate >= QuietMinBaselineRate)
            .Select(pair => new Finding(
                FindingKinds.WentQuiet,
                pair.service.Service,
                FindingFilters.Service(pair.service.Service),
                Now: 0,
                Baseline: Math.Round(pair.rate),
                Count: 0));
    }

    /// <summary>
    /// An exception type with no occurrence anywhere before the window. The baseline here is all
    /// of history rather than a trailing multiple, because "new" has to mean new: a crash the
    /// server saw in March is a returning crash, not a discovery.
    /// </summary>
    private async Task<IEnumerable<Finding>> NewExceptionsAsync(
        string baselineToUtc, string fromUtc, string toUtc, CancellationToken cancellationToken)
    {
        var window = await _events.GetTopExceptionsAsync(null, fromUtc, toUtc, GroupLimit, cancellationToken);
        if (window.Count == 0)
        {
            return [];
        }
        var known = (await _events.GetTopExceptionsAsync(null, AllHistory, baselineToUtc, GroupLimit, cancellationToken))
            .Select(row => row.Type)
            .ToHashSet();
        // an install whose whole history is inside the window has no "before" to be new against,
        // and calling every exception it has ever recorded a discovery would be noise on day one
        if (known.Count == 0)
        {
            return [];
        }

        return window
            .Where(row => !known.Contains(row.Type))
            .Select(row => new Finding(
                FindingKinds.NewException,
                row.Type,
                FindingFilters.ExceptionType(row.Type),
                Now: row.Count,
                Baseline: 0,
                Count: row.Count));
    }

    /// <summary>
    /// A route whose share of failed requests rose past what it has been doing. A share, not a
    /// count: a route that doubled its traffic doubles its errors without anything being wrong,
    /// and the count would call that a failure.
    /// </summary>
    private async Task<IEnumerable<Finding>> FailingRoutesAsync(
        string baselineFromUtc, string baselineToUtc, string fromUtc, string toUtc,
        string routeProperty, string methodProperty,
        CancellationToken cancellationToken)
    {
        var window = await _events.GetOperationOverviewAsync(
            null, fromUtc, toUtc, routeProperty, methodProperty, StatusProperty, GroupLimit,
            cancellationToken: cancellationToken);
        var candidates = window.Where(op => op.Total >= RouteMinRequests && op.ErrorCount > 0).ToList();
        if (candidates.Count == 0)
        {
            return [];
        }

        var baseline = (await _events.GetOperationOverviewAsync(
                null, baselineFromUtc, baselineToUtc, routeProperty, methodProperty, StatusProperty, GroupLimit,
                cancellationToken: cancellationToken))
            .ToDictionary(op => op.Template);

        var findings = new List<Finding>();
        foreach (var op in candidates)
        {
            // no baseline row means the route is new, which is a different finding than a route
            // that started failing — and one this detector would only guess at
            if (!baseline.TryGetValue(op.Template, out var before) || before.Total < RouteMinRequests)
            {
                continue;
            }
            var nowPct = 100.0 * op.ErrorCount / op.Total;
            var beforePct = 100.0 * before.ErrorCount / before.Total;
            if (nowPct - beforePct < RouteMinRise)
            {
                continue;
            }
            findings.Add(new Finding(
                FindingKinds.FailingRoute,
                op.Template,
                FindingFilters.Operation(op.Template, op.Route, op.Method, op.Folded, routeProperty, methodProperty),
                Now: Math.Round(nowPct, 1),
                Baseline: Math.Round(beforePct, 1),
                Count: op.ErrorCount));
        }
        return findings;
    }

    /// <summary>
    /// The existing slow-operations regression test, pointed at a trailing baseline instead of
    /// "everything older than the range". That difference is the whole reason it is repeated here
    /// rather than linked to: with the Analysis page's model, picking a wider range shrinks the
    /// baseline, so an operation younger than the range has an empty one and can never be flagged
    /// at any threshold — which is exactly the case a findings layer exists to catch.
    ///
    /// <para>Two comparisons, in order. First against the four windows before this one, which is
    /// what "slower than usual" ought to mean. When that finds nothing the whole episode may be
    /// inside the range — somebody picked "last hour" and the thing broke forty minutes ago, so
    /// there is no "before" outside the window to compare with — and the answer is to split the
    /// window and compare its own halves. Without the second pass the layer says nothing at the
    /// default range, which is the only range most readers ever look at.</para>
    /// </summary>
    private async Task<IEnumerable<Finding>> SlowerThanUsualAsync(
        DateTimeOffset from, DateTimeOffset to,
        string baselineFromUtc, string fromUtc, string toUtc, string routeProperty, string methodProperty,
        CancellationToken cancellationToken)
    {
        var result = await _events.GetSlowOperationsAsync(
            null, baselineFromUtc, fromUtc, toUtc, "Elapsed",
            SlowMinSamples, SlowFloorMs, SlowFactor, GroupLimit, cancellationToken);

        if (result.Operations.Count == 0)
        {
            // half the window each side, so the sample gate applies to half the data — an hour of
            // traffic that clears 20 samples per half is the least that could honestly be called
            // a trend rather than two readings
            var midpoint = ClefParser.FormatTimestamp(from + (to - from) / 2);
            result = await _events.GetSlowOperationsAsync(
                null, fromUtc, midpoint, toUtc, "Elapsed",
                SlowMinSamples, SlowFloorMs, SlowFactor, GroupLimit, cancellationToken);
        }

        return result.Operations.Select(op => new Finding(
            FindingKinds.SlowerThanUsual,
            op.Template,
            // slow-operations groups by message template, so that is what identifies its rows —
            // no route/method to fold in here
            FindingFilters.Operation(op.Template, route: null, method: null, folded: false, routeProperty, methodProperty),
            Now: Math.Round(op.CurrentP95),
            Baseline: Math.Round(op.BaselineP95),
            Count: op.Count));
    }

    /// <summary>What the route grouping reads a failed request's code from, matching the stats
    /// endpoints' own default.</summary>
    private const string StatusProperty = "StatusCode";
}
