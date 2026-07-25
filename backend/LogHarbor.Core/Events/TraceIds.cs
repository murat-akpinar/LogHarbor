using Google.Protobuf;

namespace LogHarbor.Core.Events;

/// <summary>
/// W3C trace/span id normalization, shared by the CLEF and OTLP ingestion paths.
/// An id is fixed-length hex and never all-zero; anything else stores as null rather than
/// rejecting the event.
/// </summary>
/// <remarks>
/// This lived in three places — ClefParser.NormalizeId over a hex string, and byte-identical
/// ToHexId copies in OtlpLogParser and OtlpTraceParser. `@TraceId = '...'` matching a request
/// across both ingestion paths depends on all of them agreeing, so they belong together.
/// </remarks>
public static class TraceIds
{
    public const int TraceIdHexLength = 32;
    public const int SpanIdHexLength = 16;

    private const int TraceIdByteLength = TraceIdHexLength / 2;
    private const int SpanIdByteLength = SpanIdHexLength / 2;

    public static string? NormalizeTrace(string? value) => Normalize(value, TraceIdHexLength);

    public static string? NormalizeSpan(string? value) => Normalize(value, SpanIdHexLength);

    public static string? FromTraceBytes(ByteString id) => FromBytes(id, TraceIdByteLength);

    public static string? FromSpanBytes(ByteString id) => FromBytes(id, SpanIdByteLength);

    /// <summary>Lowercased so filters stay exact-match reliable whichever path ingested the event.</summary>
    private static string? Normalize(string? value, int expectedLength)
    {
        if (value is null || value.Length != expectedLength)
        {
            return null;
        }
        var allZero = true;
        foreach (var c in value)
        {
            if (!char.IsAsciiHexDigit(c))
            {
                return null;
            }
            allZero &= c == '0';
        }
        return allZero ? null : value.ToLowerInvariant();
    }

    private static string? FromBytes(ByteString id, int expectedLength)
    {
        if (id.Length != expectedLength)
        {
            return null;
        }
        var bytes = id.ToByteArray();
        return bytes.All(b => b == 0) ? null : Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
