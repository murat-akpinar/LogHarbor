using Microsoft.Data.Sqlite;

namespace LogHarbor.Core.Storage;

public sealed class SqliteSpanStore : ISpanStore
{
    private const string Columns =
        "id, trace_id, span_id, parent_span_id, name, kind, service, " +
        "start_timestamp, duration_ms, status_code, status_message, attributes, ingested_at";

    private readonly LogHarborDb _db;

    public SqliteSpanStore(LogHarborDb db) => _db = db;

    public async Task WriteBatchAsync(
        IReadOnlyList<Span> spans, CancellationToken cancellationToken = default)
    {
        if (spans.Count == 0)
        {
            return;
        }

        using var connection = _db.OpenConnection();
        using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText =
            "INSERT INTO spans (trace_id, span_id, parent_span_id, name, kind, service, " +
            "start_timestamp, duration_ms, status_code, status_message, attributes, ingested_at) " +
            "VALUES (@traceId, @spanId, @parentSpanId, @name, @kind, @service, " +
            "@start, @duration, @statusCode, @statusMessage, @attributes, @ingestedAt);";

        var traceId = command.Parameters.Add("@traceId", SqliteType.Text);
        var spanId = command.Parameters.Add("@spanId", SqliteType.Text);
        var parentSpanId = command.Parameters.Add("@parentSpanId", SqliteType.Text);
        var name = command.Parameters.Add("@name", SqliteType.Text);
        var kind = command.Parameters.Add("@kind", SqliteType.Text);
        var service = command.Parameters.Add("@service", SqliteType.Text);
        var start = command.Parameters.Add("@start", SqliteType.Text);
        var duration = command.Parameters.Add("@duration", SqliteType.Real);
        var statusCode = command.Parameters.Add("@statusCode", SqliteType.Text);
        var statusMessage = command.Parameters.Add("@statusMessage", SqliteType.Text);
        var attributes = command.Parameters.Add("@attributes", SqliteType.Text);
        var ingestedAt = command.Parameters.Add("@ingestedAt", SqliteType.Text);

        foreach (var span in spans)
        {
            traceId.Value = span.TraceId;
            spanId.Value = span.SpanId;
            parentSpanId.Value = (object?)span.ParentSpanId ?? DBNull.Value;
            name.Value = span.Name;
            kind.Value = span.Kind;
            service.Value = (object?)span.Service ?? DBNull.Value;
            start.Value = span.StartTimestamp;
            duration.Value = span.DurationMs;
            statusCode.Value = span.StatusCode;
            statusMessage.Value = (object?)span.StatusMessage ?? DBNull.Value;
            attributes.Value = (object?)span.Attributes ?? DBNull.Value;
            ingestedAt.Value = span.IngestedAt;
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Span>> GetTraceAsync(
        string traceId, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            $"SELECT {Columns} FROM spans WHERE trace_id = @traceId ORDER BY start_timestamp, id;";
        command.Parameters.AddWithValue("@traceId", traceId);

        var spans = new List<Span>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            spans.Add(new Span(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.GetString(7),
                reader.GetDouble(8),
                reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetString(10),
                reader.IsDBNull(11) ? null : reader.GetString(11),
                reader.GetString(12)));
        }
        return spans;
    }

    public async Task<long> DeleteSpansOlderThanAsync(
        string cutoffUtc, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM spans WHERE start_timestamp < @cutoff;";
        command.Parameters.AddWithValue("@cutoff", cutoffUtc);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
