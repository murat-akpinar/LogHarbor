using LogHarbor.Core.Events;

namespace LogHarbor.Core.Analysis;

/// <summary>
/// What kind of thing the server noticed. Wire values are strings, like every other enumerated
/// value this API returns (IIngestRejectionStore's reasons): an int on the wire is a value whose
/// meaning lives only in a header the reader does not have.
///
/// <para>Each kind is a different question, so the numbers on a <see cref="Finding"/> mean
/// different things and only the reader's phrasing tells them apart.</para>
/// </summary>
public static class FindingKinds
{
    /// <summary>A service that logged steadily and then logged nothing at all.</summary>
    public const string WentQuiet = "went_quiet";

    /// <summary>An exception type this server had never recorded before the window.</summary>
    public const string NewException = "new_exception";

    /// <summary>A route whose share of failed requests climbed past its own recent normal.</summary>
    public const string FailingRoute = "failing_route";

    /// <summary>An operation whose p95 latency climbed past its own recent normal.</summary>
    public const string SlowerThanUsual = "slower_than_usual";

    /// <summary>
    /// The order findings are presented in, most urgent first. Silence leads deliberately: it is
    /// the one thing a reader cannot discover by looking harder at what is in front of them —
    /// everything else is at least visible somewhere on some page.
    /// </summary>
    public static readonly string[] ByUrgency = [WentQuiet, NewException, FailingRoute, SlowerThanUsual];
}

/// <summary>
/// One thing worth a look, found without anybody having written a rule for it.
///
/// A finding is never an alarm. It is not stored, not acknowledged and never fires a webhook: an
/// automatic detector produces false positives, and spending an alarm's credibility on them would
/// cost more than the detector is worth. It is computed from the range the reader is already
/// looking at, so it is as current as the page and disappears on its own when the cause does.
///
/// <para><see cref="Now"/> and <see cref="Baseline"/> are the comparison that made it a finding,
/// in whatever unit the kind measures — a percentage of failed requests, a p95 in milliseconds,
/// an event count. <see cref="Count"/> is always how many events stand behind it, which is what
/// stops a finding resting on three samples reading like one resting on three thousand.</para>
/// </summary>
/// <param name="Filter">Opens exactly the events the finding was derived from. Built here rather
/// than in the reader so there is one authority for it, and so "make this an alert" can hand it
/// straight to a rule.</param>
/// <param name="Kind">One of <see cref="FindingKinds"/>.</param>
public sealed record Finding(
    string Kind,
    string Subject,
    string Filter,
    double Now,
    double Baseline,
    long Count);

/// <summary>Filter expressions for the things a finding can be about. Mirrors what the reader
/// builds for the same rows (frontend lib/filter.ts, lib/operations.ts, ServicesPage) — the
/// duplication moves here so a finding's deep link cannot drift from the row it came from.</summary>
public static class FindingFilters
{
    /// <summary>Quotes a value as a filter string literal, doubling embedded quotes.</summary>
    public static string Quote(string value) => $"'{value.Replace("'", "''")}'";

    /// <summary>Events can carry either spelling of service identity, so match both.</summary>
    public static string Service(string service) =>
        $"(service.name = {Quote(service)} or Service = {Quote(service)})";

    /// <summary>Events whose exception text starts with the group's type name.</summary>
    public static string ExceptionType(string type) => $"@Exception like {Quote(type + "%")}";

    /// <summary>
    /// The events one operation row was aggregated from. A route group was not grouped by message
    /// template — one template covers every route an app serves — so the template would open all
    /// of them. A folded row is the case where the row's own text appears in no event at all: the
    /// server put the {id} placeholders there, so the filter has to match the shape.
    /// </summary>
    public static string Operation(
        string template, string? route, string? method, bool folded,
        string routeProperty, string methodProperty)
    {
        if (string.IsNullOrEmpty(route))
        {
            return $"@MessageTemplate = {Quote(template)}";
        }
        var clause = folded
            ? $"{routeProperty} like {Quote(route.Replace(RoutePath.Placeholder, "%"))}"
            : $"{routeProperty} = {Quote(route)}";
        return method is null ? clause : $"{clause} and {methodProperty} = {Quote(method)}";
    }
}
