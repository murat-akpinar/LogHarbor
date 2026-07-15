using System.Globalization;

namespace LogHarbor.Core.Events;

/// <summary>Parses user-supplied ISO-8601 timestamps (query params, request bodies) the same way ingestion does.</summary>
public static class TimestampParsing
{
    public static bool TryParseUtc(string? input, out DateTimeOffset value) =>
        DateTimeOffset.TryParse(
            input, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out value);
}
