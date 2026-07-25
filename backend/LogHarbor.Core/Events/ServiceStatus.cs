namespace LogHarbor.Core.Events;

/// <summary>
/// The newest service-probe reading for one (host, service), exactly as stored.
/// Up is null when the probe could not tell (docs/service-status.md).
/// </summary>
public sealed record ServiceStatusReading(
    string Host, string? Kind, string Service, long? Up, string? State, string? Health, string LastSeen);

/// <summary>A reading turned into a status, carrying the age that decided it.</summary>
public sealed record ServiceStatusRow(
    string Host, string? Kind, string Service, string Status,
    string? State, string? Health, string LastSeen, long SecondsSinceLastSeen);

/// <summary>
/// Turns probe readings into up/down/stale/unhealthy/unknown, judged against the end of the
/// queried range rather than wall-clock now: a historical range then reads as how things stood
/// then, and the answer is deterministic.
/// </summary>
public static class ServiceStatus
{
    public const string Up = "up";
    public const string Down = "down";
    public const string Stale = "stale";
    public const string Unhealthy = "unhealthy";
    public const string Unknown = "unknown";

    // the board leads with what is broken; ties fall back to host then service
    private static readonly string[] Severity = [Down, Stale, Unhealthy, Unknown, Up];

    public static IReadOnlyList<ServiceStatusRow> Evaluate(
        IEnumerable<ServiceStatusReading> readings, DateTimeOffset asOf, int staleMinutes)
    {
        var staleAfter = TimeSpan.FromMinutes(staleMinutes);
        return readings
            .Select(reading => Evaluate(reading, asOf, staleAfter))
            .OrderBy(row => Array.IndexOf(Severity, row.Status))
            .ThenBy(row => row.Host, StringComparer.Ordinal)
            .ThenBy(row => row.Service, StringComparer.Ordinal)
            .ToList();
    }

    private static ServiceStatusRow Evaluate(
        ServiceStatusReading reading, DateTimeOffset asOf, TimeSpan staleAfter)
    {
        // an unreadable timestamp cannot prove freshness, so it reads as a stopped heartbeat
        var parsed = TimestampParsing.TryParseUtc(reading.LastSeen, out var lastSeen);
        var age = parsed ? asOf - lastSeen : staleAfter + TimeSpan.FromSeconds(1);
        // a host clock running ahead of the server must not read as a negative age
        var seconds = (long)Math.Max(0, Math.Round(age.TotalSeconds));

        var status = age > staleAfter ? Stale
            : reading.Up is null ? Unknown
            : reading.Up == 0 ? Down
            : string.Equals(reading.Health, "unhealthy", StringComparison.OrdinalIgnoreCase) ? Unhealthy
            : Up;

        return new ServiceStatusRow(
            reading.Host, reading.Kind, reading.Service, status,
            reading.State, reading.Health, reading.LastSeen, seconds);
    }
}
