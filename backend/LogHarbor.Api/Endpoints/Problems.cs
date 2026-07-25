using LogHarbor.Core.Events;

namespace LogHarbor.Api.Endpoints;

/// <summary>
/// Shared endpoint responses and request-shaping helpers. Each of these had a private copy in
/// most of the nine endpoint files, in two slightly different shapes — the kind of drift where
/// one handler starts answering 400 with a different body than its neighbour.
/// </summary>
internal static class Problems
{
    public static IResult BadRequest(string title, string detail) =>
        Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: title, detail: detail);

    public static IResult BadRequest(string detail) => BadRequest("Invalid request", detail);

    public static IResult NotFound(string title) =>
        Results.Problem(statusCode: StatusCodes.Status404NotFound, title: title);
}

internal static class Timestamps
{
    /// <summary>
    /// Reformats a user-supplied bound to the stored fixed-width UTC format, so string
    /// comparison stays chronological. Null/blank passes through as null (an open bound).
    /// Returns false when the input is not a timestamp at all.
    /// </summary>
    public static bool TryNormalize(string? input, out string? normalized)
    {
        normalized = null;
        if (string.IsNullOrWhiteSpace(input))
        {
            return true;
        }
        if (!TimestampParsing.TryParseUtc(input, out var parsed))
        {
            return false;
        }
        normalized = ClefParser.FormatTimestamp(parsed);
        return true;
    }
}
