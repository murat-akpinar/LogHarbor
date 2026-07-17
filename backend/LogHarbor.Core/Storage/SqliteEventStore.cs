using System.Diagnostics;
using Microsoft.Data.Sqlite;
using LogHarbor.Core.Events;
using LogHarbor.Core.Query;
using LogHarbor.Core.Telemetry;

namespace LogHarbor.Core.Storage;

public sealed class SqliteEventStore : IEventStore
{
    private const string Columns =
        "id, timestamp, level, message, message_template, properties, exception, ingested_at, trace_id, span_id";

    private readonly LogHarborDb _db;

    public SqliteEventStore(LogHarborDb db) => _db = db;

    public async Task<IReadOnlyList<long>> WriteBatchAsync(
        IReadOnlyList<Event> events, CancellationToken cancellationToken = default)
    {
        if (events.Count == 0)
        {
            return [];
        }

        using var connection = _db.OpenConnection();
        using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText =
            "INSERT INTO events (timestamp, level, message, message_template, properties, exception, ingested_at, trace_id, span_id) " +
            "VALUES (@timestamp, @level, @message, @messageTemplate, @properties, @exception, @ingestedAt, @traceId, @spanId); " +
            "SELECT last_insert_rowid();";

        var timestamp = command.Parameters.Add("@timestamp", SqliteType.Text);
        var level = command.Parameters.Add("@level", SqliteType.Text);
        var message = command.Parameters.Add("@message", SqliteType.Text);
        var messageTemplate = command.Parameters.Add("@messageTemplate", SqliteType.Text);
        var properties = command.Parameters.Add("@properties", SqliteType.Text);
        var exception = command.Parameters.Add("@exception", SqliteType.Text);
        var ingestedAt = command.Parameters.Add("@ingestedAt", SqliteType.Text);
        var traceId = command.Parameters.Add("@traceId", SqliteType.Text);
        var spanId = command.Parameters.Add("@spanId", SqliteType.Text);

        var ids = new List<long>(events.Count);
        foreach (var item in events)
        {
            timestamp.Value = item.Timestamp;
            level.Value = item.Level;
            message.Value = item.Message;
            messageTemplate.Value = (object?)item.MessageTemplate ?? DBNull.Value;
            properties.Value = (object?)item.Properties ?? DBNull.Value;
            exception.Value = (object?)item.Exception ?? DBNull.Value;
            ingestedAt.Value = item.IngestedAt;
            traceId.Value = (object?)item.TraceId ?? DBNull.Value;
            spanId.Value = (object?)item.SpanId ?? DBNull.Value;
            ids.Add((long)(await command.ExecuteScalarAsync(cancellationToken))!);
        }

        await transaction.CommitAsync(cancellationToken);
        return ids;
    }

    public async Task<IReadOnlyList<Event>> MatchAsync(
        QuerySql? filter, IReadOnlyList<long> ids, CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0)
        {
            return [];
        }

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();

        var idParameters = new string[ids.Count];
        for (var i = 0; i < ids.Count; i++)
        {
            idParameters[i] = $"@id{i}";
            command.Parameters.AddWithValue(idParameters[i], ids[i]);
        }

        var filterClause = "";
        if (filter is not null)
        {
            filterClause = $" AND ({filter.Sql})";
            foreach (var (name, value) in filter.Parameters)
            {
                command.Parameters.AddWithValue(name, value);
            }
        }

        command.CommandText =
            $"SELECT {Columns} FROM events WHERE id IN ({string.Join(", ", idParameters)}){filterClause} ORDER BY id DESC;";

        var events = new List<Event>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            events.Add(ReadEvent(reader));
        }
        return events;
    }

    public async Task<EventPage> QueryAsync(EventQuery query, CancellationToken cancellationToken = default)
    {
        var started = Stopwatch.GetTimestamp();
        try
        {
            return await QueryCoreAsync(query, cancellationToken);
        }
        finally
        {
            LogHarborMetrics.QueryDuration.Record(Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        }
    }

    private async Task<EventPage> QueryCoreAsync(EventQuery query, CancellationToken cancellationToken)
    {
        using var connection = _db.OpenConnection();

        // the archive day granularity is one UTC day, and timestamps are fixed-width
        // ISO-8601, so the first 10 chars of a bound are its day
        var fromDay = query.From?[..10];
        var toDay = query.To?[..10];
        var (archivedDays, anyHydrated) =
            await GetOverlappingSegmentsAsync(connection, fromDay, toDay, cancellationToken);
        if (anyHydrated)
        {
            await TouchHydratedSegmentsAsync(connection, fromDay, toDay, cancellationToken);
        }

        using var command = connection.CreateCommand();
        if (query.Filter is not null)
        {
            foreach (var (name, value) in query.Filter.Parameters)
            {
                command.Parameters.AddWithValue(name, value);
            }
        }
        if (query.From is not null)
        {
            command.Parameters.AddWithValue("@from", query.From);
        }
        if (query.To is not null)
        {
            command.Parameters.AddWithValue("@to", query.To);
        }
        if (query.AfterId is not null)
        {
            command.Parameters.AddWithValue("@afterId", query.AfterId);
        }

        string Where(string? filterSql)
        {
            var conditions = new List<string>();
            if (filterSql is not null)
            {
                conditions.Add($"({filterSql})");
            }
            if (query.From is not null)
            {
                conditions.Add("timestamp >= @from");
            }
            if (query.To is not null)
            {
                conditions.Add("timestamp <= @to");
            }
            if (query.AfterId is not null)
            {
                conditions.Add("id < @afterId");
            }
            return conditions.Count > 0 ? " WHERE " + string.Join(" AND ", conditions) : "";
        }

        var hotSelect = $"SELECT {Columns} FROM events{Where(query.Filter?.Sql)}";
        // ids never collide across hot and cache (AUTOINCREMENT + preserved originals),
        // so UNION ALL is safe and the id sort stays a gap-free pagination cursor
        command.CommandText = anyHydrated
            ? $"SELECT {Columns} FROM ({hotSelect} UNION ALL " +
              $"SELECT {Columns} FROM events_cache{Where(query.Filter?.SqlFor("events_cache_fts"))}) " +
              "ORDER BY id DESC LIMIT @limit;"
            : $"{hotSelect} ORDER BY id DESC LIMIT @limit;";
        // one extra row tells us whether a next page exists without a second COUNT query
        command.Parameters.AddWithValue("@limit", query.Count + 1);

        var events = new List<Event>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            events.Add(ReadEvent(reader));
        }

        var hasMore = events.Count > query.Count;
        if (hasMore)
        {
            events.RemoveAt(events.Count - 1);
        }
        return new EventPage(events, hasMore, archivedDays);
    }

    public async Task<Event?> FindAsync(long id, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using (var command = connection.CreateCommand())
        {
            command.CommandText = $"SELECT {Columns} FROM events WHERE id = @id;";
            command.Parameters.AddWithValue("@id", id);
            using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                return ReadEvent(reader);
            }
        }

        using var cacheCommand = connection.CreateCommand();
        cacheCommand.CommandText = $"SELECT {Columns}, segment_day FROM events_cache WHERE id = @id;";
        cacheCommand.Parameters.AddWithValue("@id", id);
        using var cacheReader = await cacheCommand.ExecuteReaderAsync(cancellationToken);
        if (!await cacheReader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var found = ReadEvent(cacheReader);
        await TouchSegmentAsync(connection, cacheReader.GetString(10), cancellationToken);
        return found;
    }

    private static async Task<(IReadOnlyList<string> ArchivedDays, bool AnyHydrated)> GetOverlappingSegmentsAsync(
        SqliteConnection connection, string? fromDay, string? toDay, CancellationToken cancellationToken)
    {
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT day, status FROM archive_segments " +
            "WHERE (@fromDay IS NULL OR day >= @fromDay) AND (@toDay IS NULL OR day <= @toDay) " +
            "ORDER BY day;";
        command.Parameters.AddWithValue("@fromDay", (object?)fromDay ?? DBNull.Value);
        command.Parameters.AddWithValue("@toDay", (object?)toDay ?? DBNull.Value);

        var archivedDays = new List<string>();
        var anyHydrated = false;
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            if (reader.GetString(1) == "hydrated")
            {
                anyHydrated = true;
            }
            else
            {
                archivedDays.Add(reader.GetString(0));
            }
        }
        return (archivedDays, anyHydrated);
    }

    /// <summary>Eviction keys off last_accessed_at, so every search touching a hydrated segment renews it.</summary>
    private static async Task TouchHydratedSegmentsAsync(
        SqliteConnection connection, string? fromDay, string? toDay, CancellationToken cancellationToken)
    {
        using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE archive_segments SET last_accessed_at = @now WHERE status = 'hydrated' " +
            "AND (@fromDay IS NULL OR day >= @fromDay) AND (@toDay IS NULL OR day <= @toDay);";
        command.Parameters.AddWithValue("@now", ClefParser.FormatTimestamp(DateTimeOffset.UtcNow));
        command.Parameters.AddWithValue("@fromDay", (object?)fromDay ?? DBNull.Value);
        command.Parameters.AddWithValue("@toDay", (object?)toDay ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task TouchSegmentAsync(
        SqliteConnection connection, string day, CancellationToken cancellationToken)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE archive_segments SET last_accessed_at = @now WHERE day = @day;";
        command.Parameters.AddWithValue("@now", ClefParser.FormatTimestamp(DateTimeOffset.UtcNow));
        command.Parameters.AddWithValue("@day", day);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<HistogramBucket>> GetHistogramAsync(
        QuerySql? filter, DateTimeOffset from, DateTimeOffset to, int buckets, CancellationToken cancellationToken = default)
    {
        var fromUtc = ClefParser.FormatTimestamp(from);
        var toUtc = ClefParser.FormatTimestamp(to);
        var bucketSeconds = (to - from).TotalSeconds / buckets;

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();

        var filterClause = "";
        if (filter is not null)
        {
            filterClause = $" AND ({filter.Sql})";
            foreach (var (name, value) in filter.Parameters)
            {
                command.Parameters.AddWithValue(name, value);
            }
        }

        // julianday() reads our fixed-width ISO-8601 timestamp directly; bucket_index truncates
        // toward zero, which is floor() here since every matched row has timestamp >= @from
        command.CommandText =
            "SELECT CAST((julianday(timestamp) - julianday(@from)) * 86400.0 / @bucketSeconds AS INTEGER) AS bucket_index, " +
            "level, COUNT(*) AS cnt " +
            $"FROM events WHERE timestamp >= @from AND timestamp <= @to{filterClause} " +
            "GROUP BY bucket_index, level;";
        command.Parameters.AddWithValue("@from", fromUtc);
        command.Parameters.AddWithValue("@to", toUtc);
        command.Parameters.AddWithValue("@bucketSeconds", bucketSeconds);

        var counts = new Dictionary<int, Dictionary<string, long>>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            // clamp in long space first: an event exactly at `to` can float-round into bucket `buckets`
            var bucketIndex = (int)Math.Clamp(reader.GetInt64(0), 0, buckets - 1);
            var level = reader.GetString(1);
            if (!counts.TryGetValue(bucketIndex, out var levelCounts))
            {
                levelCounts = [];
                counts[bucketIndex] = levelCounts;
            }
            levelCounts[level] = levelCounts.GetValueOrDefault(level) + reader.GetInt64(2);
        }

        var result = new List<HistogramBucket>(buckets);
        for (var i = 0; i < buckets; i++)
        {
            var start = ClefParser.FormatTimestamp(from.AddSeconds(bucketSeconds * i));
            var levelCounts = Levels.All.ToDictionary(
                level => level,
                level => counts.TryGetValue(i, out var byLevel) ? byLevel.GetValueOrDefault(level) : 0L);
            result.Add(new HistogramBucket(start, levelCounts));
        }
        return result;
    }

    public async Task<StatsSummary> GetSummaryAsync(
        QuerySql? filter, string fromUtc, string toUtc, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();

        var filterClause = "";
        if (filter is not null)
        {
            filterClause = $" AND ({filter.Sql})";
            foreach (var (name, value) in filter.Parameters)
            {
                command.Parameters.AddWithValue(name, value);
            }
        }

        command.CommandText =
            $"SELECT level, COUNT(*) FROM events WHERE timestamp >= @from AND timestamp <= @to{filterClause} GROUP BY level;";
        command.Parameters.AddWithValue("@from", fromUtc);
        command.Parameters.AddWithValue("@to", toUtc);

        var byLevel = Levels.All.ToDictionary(level => level, _ => 0L);
        var total = 0L;
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var count = reader.GetInt64(1);
            byLevel[reader.GetString(0)] = count;
            total += count;
        }
        return new StatsSummary(total, byLevel);
    }

    public async Task<IReadOnlyList<TopError>> GetTopErrorsAsync(
        QuerySql? filter, string fromUtc, string toUtc, IReadOnlyList<string> levels, int limit,
        CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "message_template, level, timestamp", fromUtc, toUtc, cancellationToken);

        var levelParameters = new string[levels.Count];
        for (var i = 0; i < levels.Count; i++)
        {
            levelParameters[i] = $"@level{i}";
            command.Parameters.AddWithValue(levelParameters[i], levels[i]);
        }

        // ponytail: events without a CLEF @mt have no group identity and are left out;
        // fall back to grouping by message if plain-text senders ever matter
        command.CommandText =
            "SELECT message_template, level, COUNT(*) AS cnt, MIN(timestamp), MAX(timestamp) " +
            $"FROM {source} WHERE message_template IS NOT NULL AND level IN ({string.Join(", ", levelParameters)}) " +
            "GROUP BY message_template, level ORDER BY cnt DESC, message_template LIMIT @limit;";
        command.Parameters.AddWithValue("@limit", limit);

        var rows = new List<TopError>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new TopError(
                reader.GetString(0), reader.GetString(1), reader.GetInt64(2),
                reader.GetString(3), reader.GetString(4)));
        }
        return rows;
    }

    public async Task<IReadOnlyList<SlowOperation>> GetSlowOperationsAsync(
        QuerySql? filter, string baselineFromUtc, string splitUtc, string toUtc,
        string property, int minSamples, double floorMs, double factor, int limit,
        CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        // wide window [baseline, to); the baseline/current split happens in SQL by @split
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "message_template, properties, timestamp",
            baselineFromUtc, toUtc, cancellationToken);

        // safe to embed: property is restricted to [A-Za-z0-9_.] at the API boundary;
        // the quoted step keeps dots literal
        var extract = $"json_extract(properties, '$.\"{property}\"')";
        command.CommandText =
            "WITH v AS (" +
            $"SELECT message_template AS tmpl, CAST({extract} AS REAL) AS ms, " +
            "CASE WHEN timestamp < @split THEN 0 ELSE 1 END AS cur " +
            $"FROM {source} WHERE message_template IS NOT NULL AND {extract} IS NOT NULL), " +
            // ROW_NUMBER (not PERCENT_RANK) so a burst of equal durations doesn't collapse to rank 0
            "r AS (SELECT tmpl, cur, ms, " +
            "ROW_NUMBER() OVER (PARTITION BY tmpl, cur ORDER BY ms) AS rn, " +
            "COUNT(*) OVER (PARTITION BY tmpl, cur) AS n FROM v), " +
            "p AS (SELECT tmpl, cur, MAX(n) AS n, MIN(ms) FILTER (WHERE rn >= 0.95 * n) AS p95 " +
            "FROM r GROUP BY tmpl, cur) " +
            "SELECT b.tmpl, b.p95 AS base_p95, c.p95 AS cur_p95, c.n AS cur_n " +
            "FROM p b JOIN p c ON c.tmpl = b.tmpl AND b.cur = 0 AND c.cur = 1 " +
            "WHERE b.n >= @minSamples AND c.n >= @minSamples AND b.p95 >= @floorMs AND b.p95 > 0 " +
            "AND c.p95 >= b.p95 * @factor " +
            "ORDER BY c.p95 / b.p95 DESC, c.p95 DESC LIMIT @limit;";
        command.Parameters.AddWithValue("@split", splitUtc);
        command.Parameters.AddWithValue("@minSamples", minSamples);
        command.Parameters.AddWithValue("@floorMs", floorMs);
        command.Parameters.AddWithValue("@factor", factor);
        command.Parameters.AddWithValue("@limit", limit);

        var rows = new List<SlowOperation>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new SlowOperation(
                reader.GetString(0), reader.GetDouble(1), reader.GetDouble(2), reader.GetInt64(3)));
        }
        return rows;
    }

    public async Task<IReadOnlyList<TopException>> GetTopExceptionsAsync(
        QuerySql? filter, string fromUtc, string toUtc, int limit, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "exception, timestamp", fromUtc, toUtc, cancellationToken);

        // exception type = first line up to ':' (whole first line when no colon); rtrim drops the \r of CRLF text
        command.CommandText =
            "SELECT CASE WHEN instr(first_line, ':') > 0 THEN substr(first_line, 1, instr(first_line, ':') - 1) " +
            "ELSE first_line END AS ex_type, COUNT(*) AS cnt, MIN(timestamp), MAX(timestamp) FROM (" +
            "SELECT rtrim(CASE WHEN instr(exception, char(10)) > 0 " +
            "THEN substr(exception, 1, instr(exception, char(10)) - 1) ELSE exception END, char(13)) AS first_line, " +
            $"timestamp FROM {source} WHERE exception IS NOT NULL) " +
            "GROUP BY ex_type ORDER BY cnt DESC, ex_type LIMIT @limit;";
        command.Parameters.AddWithValue("@limit", limit);

        var rows = new List<TopException>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new TopException(
                reader.GetString(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3)));
        }
        return rows;
    }

    public async Task<IReadOnlyList<PropertyValueCount>> GetPropertyValuesAsync(
        QuerySql? filter, string fromUtc, string toUtc, string property, int limit,
        CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "properties", fromUtc, toUtc, cancellationToken);

        // safe to embed: property is restricted to [A-Za-z0-9_.] at the API boundary;
        // the quoted step keeps dots literal
        var extract = $"json_extract(properties, '$.\"{property}\"')";
        command.CommandText =
            $"SELECT CAST({extract} AS TEXT) AS value, COUNT(*) AS cnt FROM {source} " +
            $"WHERE {extract} IS NOT NULL GROUP BY value ORDER BY cnt DESC, value LIMIT @limit;";
        command.Parameters.AddWithValue("@limit", limit);

        var rows = new List<PropertyValueCount>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new PropertyValueCount(reader.GetString(0), reader.GetInt64(1)));
        }
        return rows;
    }

    /// <summary>
    /// Builds the FROM source for stats aggregates: hot events only, or hot UNION ALL hydrated cache
    /// when the range touches hydrated segments (same pattern as QueryAsync, including the eviction
    /// touch). Binds @from/@to and the filter parameters onto <paramref name="command"/>.
    /// </summary>
    public async Task<IReadOnlyList<HeatmapCell>> GetHeatmapAsync(
        QuerySql? filter, string fromUtc, string toUtc, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "timestamp", fromUtc, toUtc, cancellationToken);

        // strftime reads our fixed-width UTC ISO-8601 timestamps directly; %w: 0 = Sunday
        command.CommandText =
            "SELECT CAST(strftime('%w', timestamp) AS INTEGER) AS dow, " +
            "CAST(strftime('%H', timestamp) AS INTEGER) AS hour, COUNT(*) AS cnt " +
            $"FROM {source} GROUP BY dow, hour ORDER BY dow, hour;";

        var rows = new List<HeatmapCell>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new HeatmapCell(reader.GetInt32(0), reader.GetInt32(1), reader.GetInt64(2)));
        }
        return rows;
    }

    private static async Task<string> BuildStatsSourceAsync(
        SqliteConnection connection, SqliteCommand command, QuerySql? filter,
        string columns, string fromUtc, string toUtc, CancellationToken cancellationToken)
    {
        var (_, anyHydrated) = await GetOverlappingSegmentsAsync(
            connection, fromUtc[..10], toUtc[..10], cancellationToken);
        if (anyHydrated)
        {
            await TouchHydratedSegmentsAsync(connection, fromUtc[..10], toUtc[..10], cancellationToken);
        }
        if (filter is not null)
        {
            foreach (var (name, value) in filter.Parameters)
            {
                command.Parameters.AddWithValue(name, value);
            }
        }
        command.Parameters.AddWithValue("@from", fromUtc);
        command.Parameters.AddWithValue("@to", toUtc);

        string Select(string table, string? filterSql) =>
            $"SELECT {columns} FROM {table} WHERE timestamp >= @from AND timestamp <= @to" +
            (filterSql is null ? "" : $" AND ({filterSql})");

        var hot = Select("events", filter?.Sql);
        return anyHydrated
            ? $"({hot} UNION ALL {Select("events_cache", filter?.SqlFor("events_cache_fts"))})"
            : $"({hot})";
    }

    // suggestions reflect what is being logged NOW, so only the newest events are scanned
    private const int SuggestionScanRows = 1000;

    public async Task<IReadOnlyList<string>> SuggestPropertyNamesAsync(
        string prefix, int limit, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT DISTINCT je.key FROM (" +
            $"SELECT properties FROM events WHERE properties IS NOT NULL ORDER BY id DESC LIMIT {SuggestionScanRows}" +
            ") recent, json_each(recent.properties) je " +
            "WHERE je.key LIKE @prefix || '%' ESCAPE '\\' ORDER BY je.key LIMIT @limit;";
        command.Parameters.AddWithValue("@prefix", EscapeLike(prefix));
        command.Parameters.AddWithValue("@limit", limit);
        return await ReadStringsAsync(command, cancellationToken);
    }

    public async Task<IReadOnlyList<string>> SuggestPropertyValuesAsync(
        string property, string prefix, int limit, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT DISTINCT CAST(je.value AS TEXT) FROM (" +
            $"SELECT properties FROM events WHERE properties IS NOT NULL ORDER BY id DESC LIMIT {SuggestionScanRows}" +
            ") recent, json_each(recent.properties) je " +
            "WHERE je.key = @property AND je.value IS NOT NULL " +
            "AND CAST(je.value AS TEXT) LIKE @prefix || '%' ESCAPE '\\' ORDER BY 1 LIMIT @limit;";
        command.Parameters.AddWithValue("@property", property);
        command.Parameters.AddWithValue("@prefix", EscapeLike(prefix));
        command.Parameters.AddWithValue("@limit", limit);
        return await ReadStringsAsync(command, cancellationToken);
    }

    private static string EscapeLike(string value) =>
        value.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    private static async Task<IReadOnlyList<string>> ReadStringsAsync(
        SqliteCommand command, CancellationToken cancellationToken)
    {
        var values = new List<string>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            values.Add(reader.GetString(0));
        }
        return values;
    }

    private static Event ReadEvent(SqliteDataReader reader) => new(
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
