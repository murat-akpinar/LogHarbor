namespace LogHarbor.Core.Analysis;

/// <summary>
/// What "usual" means, in the one place both features that say it can read: the findings scan and
/// /api/stats/slow-operations, which run the same comparison and used to disagree about the
/// history they ran it against.
///
/// <para>A baseline is a multiple of the window itself, capped. It is deliberately *not*
/// "everything older than the range you picked", which slow-operations started out as and which is
/// wrong twice over. It is wrong on cost — every dashboard load rescans the whole database, so the
/// endpoint gets slower every day the server runs (measured on the test instance at a 1 h range:
/// 4.3 s cold, 7.7 s warm, against 17-96 ms for every other stats call on the same page). And it is
/// wrong on meaning: widening the range moves `from` backwards, so asking about a longer period
/// *shrinks* the history it is judged against, and "usual" silently becomes a different claim.</para>
/// </summary>
public static class Baseline
{
    /// <summary>How much history a rate is judged against, as a multiple of the window itself.
    /// Four is enough for the comparison to mean something without reaching back so far that a
    /// deploy last week still counts as normal.</summary>
    public const int Windows = 4;

    /// <summary>
    /// And never further back than this, however wide the window.
    ///
    /// Four windows of a 24-hour range is four days, which cost 9.9 s to scan on a 494k-event
    /// server — against a 10 s live tick, so the findings band could never finish before the next
    /// tick replaced it. The cap is also the more honest baseline: "usual" meaning the last four
    /// days is a claim a deploy on Tuesday already falsifies, and a full day of history is enough
    /// to be usual against.
    /// </summary>
    public static readonly TimeSpan Max = TimeSpan.FromHours(24);

    /// <summary>How far back the comparison reaches for a window of this width. A window that is
    /// empty or backwards cannot be multiplied into anything meaningful, so it gets the cap — the
    /// most history this rule ever looks at.</summary>
    public static TimeSpan SpanFor(TimeSpan window)
    {
        if (window <= TimeSpan.Zero)
        {
            return Max;
        }
        var span = window * Windows;
        return span > Max ? Max : span;
    }

    /// <summary>Where the history for a window of [from, to) starts.</summary>
    public static DateTimeOffset StartFor(DateTimeOffset from, DateTimeOffset to)
        => from - SpanFor(to - from);
}
