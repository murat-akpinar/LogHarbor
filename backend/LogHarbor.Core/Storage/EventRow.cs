using Microsoft.Data.Sqlite;
using LogHarbor.Core.Events;

namespace LogHarbor.Core.Storage;

/// <summary>
/// The events column list and its reader, shared by every store that selects event rows.
/// Both `events` and `events_cache` carry these columns in this order, and they were written
/// out twice — migration 008 already needed the same edit in both places, which is exactly the
/// shape a column added to one and forgotten in the other would take.
/// </summary>
internal static class EventRow
{
    public const string Columns =
        "id, timestamp, level, message, message_template, properties, exception, ingested_at, trace_id, span_id";

    /// <summary>Reads the columns above, in order, starting at ordinal 0.</summary>
    public static Event Read(SqliteDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.GetString(2),
        reader.GetString(3),
        reader.IsDBNull(4) ? null : reader.GetString(4),
        reader.IsDBNull(5) ? null : reader.GetString(5),
        reader.IsDBNull(6) ? null : reader.GetString(6),
        reader.GetString(7),
        reader.IsDBNull(8) ? null : reader.GetString(8),
        reader.IsDBNull(9) ? null : reader.GetString(9));
}
