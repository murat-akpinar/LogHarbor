using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using LogHarbor.Core.Events;
using LogHarbor.Core.Query;
using LogHarbor.Core.Telemetry;

namespace LogHarbor.Core.Storage;

public sealed class SqliteEventStore : IEventStore
{
    private const string Columns = EventRow.Columns;

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

    // SQLite binds at most 32766 parameters per statement, and one accepted ingest request can
    // carry far more events than that: MaxBatchBytes is 5 MB and a minimal CLEF line is ~30 bytes.
    // Past the limit the command threw, TailBroadcaster logged it, and every subscriber silently
    // missed the whole batch. Chunking keeps one big batch from taking live tail down with it.
    private const int MatchIdChunkSize = 500;

    public async Task<IReadOnlyList<Event>> MatchAsync(
        QuerySql? filter, IReadOnlyList<long> ids, CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0)
        {
            return [];
        }

        using var connection = _db.OpenConnection();

        var events = new List<Event>();
        for (var offset = 0; offset < ids.Count; offset += MatchIdChunkSize)
        {
            var chunk = Math.Min(MatchIdChunkSize, ids.Count - offset);
            using var command = connection.CreateCommand();

            var idParameters = new string[chunk];
            for (var i = 0; i < chunk; i++)
            {
                idParameters[i] = $"@id{i}";
                command.Parameters.AddWithValue(idParameters[i], ids[offset + i]);
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
                $"SELECT {Columns} FROM events WHERE id IN ({string.Join(", ", idParameters)}){filterClause} " +
                "ORDER BY id DESC;";

            using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                events.Add(EventRow.Read(reader));
            }
        }

        // chunks are id-ordered among themselves; the caller expects one descending list
        events.Sort((left, right) => right.Id.CompareTo(left.Id));
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
            events.Add(EventRow.Read(reader));
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
                return EventRow.Read(reader);
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

        var found = EventRow.Read(cacheReader);
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
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "timestamp, level", fromUtc, toUtc, cancellationToken);

        // julianday() reads our fixed-width ISO-8601 timestamp directly; bucket_index truncates
        // toward zero, which is floor() here since every matched row has timestamp >= @from
        command.CommandText =
            "SELECT CAST((julianday(timestamp) - julianday(@from)) * 86400.0 / @bucketSeconds AS INTEGER) AS bucket_index, " +
            "level, COUNT(*) AS cnt " +
            $"FROM {source} GROUP BY bucket_index, level;";
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

    public async Task<LatencyOverview> GetLatencyAsync(
        QuerySql? filter, DateTimeOffset from, DateTimeOffset to, int buckets, CancellationToken cancellationToken = default)
    {
        var fromUtc = ClefParser.FormatTimestamp(from);
        var toUtc = ClefParser.FormatTimestamp(to);
        var bucketSeconds = (to - from).TotalSeconds / buckets;

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "timestamp, properties", fromUtc, toUtc, cancellationToken);

        // One pass, two shapes: the per-bucket rows and the whole range as bucket -1. A range p95
        // cannot be recovered from bucket p95s, so it has to be ranked over the same rows here
        // rather than averaged afterwards.
        //
        // ROW_NUMBER rather than NTILE, matching the operation and service overviews: a burst of
        // identical durations must not collapse the rank to 0 and report the fastest as the p95.
        command.CommandText =
            "WITH v AS MATERIALIZED (" +
            "SELECT CAST((julianday(timestamp) - julianday(@from)) * 86400.0 / @bucketSeconds AS INTEGER) AS b, " +
            "CAST(json_extract(properties, '$.\"Elapsed\"') AS REAL) AS ms " +
            $"FROM {source}), " +
            "w AS (SELECT b, ms FROM v WHERE ms IS NOT NULL), " +
            "rb AS (SELECT b, ms, ROW_NUMBER() OVER (PARTITION BY b ORDER BY ms) AS rn, " +
            "COUNT(*) OVER (PARTITION BY b) AS n FROM w), " +
            "ra AS (SELECT ms, ROW_NUMBER() OVER (ORDER BY ms) AS rn, COUNT(*) OVER () AS n FROM w) " +
            "SELECT b, COUNT(*) AS sampled, AVG(ms) AS avg_ms, " +
            "MIN(ms) FILTER (WHERE rn >= 0.95 * n) AS p95 FROM rb GROUP BY b " +
            "UNION ALL " +
            "SELECT -1, COUNT(*), AVG(ms), MIN(ms) FILTER (WHERE rn >= 0.95 * n) FROM ra;";
        command.Parameters.AddWithValue("@bucketSeconds", bucketSeconds);

        var perBucket = new Dictionary<int, (double? Avg, double? P95)>();
        double? rangeAvg = null;
        double? rangeP95 = null;
        long sampled = 0;

        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var index = reader.GetInt64(0);
            var count = reader.GetInt64(1);
            var avg = reader.IsDBNull(2) ? (double?)null : reader.GetDouble(2);
            var p95 = reader.IsDBNull(3) ? (double?)null : reader.GetDouble(3);
            if (index < 0)
            {
                // the UNION's second leg: one row for the whole range, and it is empty-safe
                // (COUNT over no rows is 0, and both figures come back null)
                sampled = count;
                rangeAvg = avg;
                rangeP95 = p95;
                continue;
            }
            // clamp in long space first: an event exactly at `to` can float-round into bucket `buckets`
            perBucket[(int)Math.Clamp(index, 0, buckets - 1)] = (avg, p95);
        }

        var series = new List<LatencyBucket>(buckets);
        for (var i = 0; i < buckets; i++)
        {
            var start = ClefParser.FormatTimestamp(from.AddSeconds(bucketSeconds * i));
            var found = perBucket.TryGetValue(i, out var value);
            series.Add(new LatencyBucket(start, found ? value.Avg : null, found ? value.P95 : null));
        }
        return new LatencyOverview(rangeAvg, rangeP95, sampled, series);
    }

    public async Task<StatsSummary> GetSummaryAsync(
        QuerySql? filter, string fromUtc, string toUtc, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "level", fromUtc, toUtc, cancellationToken);

        command.CommandText = $"SELECT level, COUNT(*) FROM {source} GROUP BY level;";

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

    public async Task<IReadOnlyList<ServiceOverview>> GetServiceOverviewAsync(
        QuerySql? filter, string fromUtc, string toUtc, int limit, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "level, properties", fromUtc, toUtc, cancellationToken);

        // "service.name" (OTLP resources) wins over "Service" (CLEF/Seq senders); the quoted
        // path steps keep the dot literal (docs/query-language.md PROPERTY ACCESS)
        command.CommandText =
            "WITH v AS (" +
            "SELECT COALESCE(json_extract(properties, '$.\"service.name\"'), " +
            "json_extract(properties, '$.\"Service\"')) AS svc, level, " +
            "CAST(json_extract(properties, '$.\"Elapsed\"') AS REAL) AS ms " +
            $"FROM {source}), " +
            "s AS (SELECT svc, COUNT(*) AS total, " +
            "SUM(CASE WHEN level IN ('Error', 'Fatal') THEN 1 ELSE 0 END) AS errors " +
            "FROM v WHERE svc IS NOT NULL GROUP BY svc), " +
            // same ROW_NUMBER percentile as GetSlowOperationsAsync: a burst of equal
            // durations must not collapse to rank 0
            "r AS (SELECT svc, ms, ROW_NUMBER() OVER (PARTITION BY svc ORDER BY ms) AS rn, " +
            "COUNT(*) OVER (PARTITION BY svc) AS n FROM v WHERE svc IS NOT NULL AND ms IS NOT NULL), " +
            "p AS (SELECT svc, MIN(ms) FILTER (WHERE rn >= 0.95 * n) AS p95 FROM r GROUP BY svc) " +
            "SELECT s.svc, s.total, s.errors, p.p95 " +
            "FROM s LEFT JOIN p ON p.svc = s.svc " +
            "ORDER BY s.total DESC, s.svc LIMIT @limit;";
        command.Parameters.AddWithValue("@limit", limit);

        var rows = new List<ServiceOverview>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new ServiceOverview(
                reader.GetString(0), reader.GetInt64(1), reader.GetInt64(2),
                reader.IsDBNull(3) ? null : reader.GetDouble(3)));
        }
        return rows;
    }

    public async Task<IReadOnlyList<ServiceStatusReading>> GetServiceStatusAsync(
        QuerySql? filter, string fromUtc, string toUtc, string source, int limit,
        CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var table = await BuildStatsSourceAsync(
            connection, command, filter, "properties, timestamp", fromUtc, toUtc, cancellationToken);

        // the probe's property names are lowercase on purpose so a status event never merges into
        // the RED metrics of an application service (docs/service-status.md); a reading that names
        // neither a host nor a service cannot be placed on the board and is dropped
        command.CommandText =
            "WITH v AS (" +
            "SELECT CAST(json_extract(properties, '$.\"host\"') AS TEXT) AS host, " +
            "CAST(json_extract(properties, '$.\"kind\"') AS TEXT) AS kind, " +
            "CAST(json_extract(properties, '$.\"service\"') AS TEXT) AS svc, " +
            "CAST(json_extract(properties, '$.\"up\"') AS INTEGER) AS up, " +
            "CAST(json_extract(properties, '$.\"state\"') AS TEXT) AS state, " +
            "CAST(json_extract(properties, '$.\"health\"') AS TEXT) AS health, timestamp " +
            $"FROM {table} WHERE json_extract(properties, '$.\"Source\"') = @source), " +
            "r AS (SELECT host, kind, svc, up, state, health, timestamp, " +
            "ROW_NUMBER() OVER (PARTITION BY host, svc ORDER BY timestamp DESC) AS rn " +
            "FROM v WHERE host IS NOT NULL AND svc IS NOT NULL) " +
            "SELECT host, kind, svc, up, state, health, timestamp FROM r WHERE rn = 1 " +
            "ORDER BY host, svc LIMIT @limit;";
        command.Parameters.AddWithValue("@source", source);
        command.Parameters.AddWithValue("@limit", limit);

        var rows = new List<ServiceStatusReading>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new ServiceStatusReading(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetInt64(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.GetString(6)));
        }
        return rows;
    }

    public async Task<IReadOnlyList<OperationOverview>> GetOperationOverviewAsync(
        QuerySql? filter, string fromUtc, string toUtc, string routeProperty, string methodProperty,
        string statusProperty, int limit, int trendBuckets = 0, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var wantsTrend = trendBuckets > 0;
        var source = await BuildStatsSourceAsync(
            connection, command,
            filter,
            wantsTrend ? "message_template, level, properties, timestamp" : "message_template, level, properties",
            fromUtc, toUtc, cancellationToken);

        // safe to embed: all three names are restricted to [A-Za-z0-9_.] at the API boundary, and
        // the quoted step keeps dots literal (http.route is one key, not a path into an object)
        var route = $"json_extract(properties, '$.\"{routeProperty}\"')";
        var method = $"json_extract(properties, '$.\"{methodProperty}\"')";
        var status = $"json_extract(properties, '$.\"{statusProperty}\"')";

        // What makes a group a route rather than a message template. The verb used to be required
        // on both counts, and that dropped exactly the traffic an operator comes here for: an
        // application that logs its failures from an exception handler writes the path and the
        // status and no verb (ordinary in Laravel, Django and Express, and what this repo's own
        // traffic-sim does), so every 5xx in the product collapsed into one "Request failed {Path}"
        // row while the successes kept their routes.
        // The discriminator is not whether the line names a verb; it is whether the line carries an
        // outcome. A 4xx/5xx status code says "this request ended, and badly" — it is that request's
        // traffic. A line with a path and no outcome ("Slow request {Path} took {Elapsed} ms", which
        // carries a 200 and a duration) is a remark *about* a path, and grouping it as a route would
        // add a second row under the same name whose p95 was measured over a different set of
        // events. Those still keep their template.
        const string isRoute = "route IS NOT NULL AND (method IS NOT NULL OR status >= 400)";

        // A request log uses one message template for every route it serves, so grouping by the
        // template alone collapses the whole application into a single row. Where the route
        // property exists the group is the route; where it does not, the template still is —
        // a job or a heartbeat is an operation too. The p95 mirrors GetServiceOverviewAsync
        // (ROW_NUMBER so a burst of equal durations doesn't collapse to rank 0).
        //
        // v is MATERIALIZED, and that is worth more than it looks: SQLite inlines an ordinary CTE,
        // so json_extract ran once per *reference* — route and method are each named three times
        // below — rather than once per row. Forcing it to materialize cut the whole query by 41%
        // on 200k events (1254 ms -> 740 ms), which is what pays for the fold underneath it.
        // The trend rides along in this same query rather than in one histogram request per row:
        // the rows are already grouped here, so counting them per bucket is one more GROUP BY over
        // a CTE that has been materialized anyway.
        //
        var trendTs = wantsTrend ? ", timestamp AS ts" : "";
        var carryTs = wantsTrend ? ", ts" : "";

        command.CommandText =
            "WITH v AS MATERIALIZED (" +
            $"SELECT message_template AS tmpl, CAST({route} AS TEXT) AS raw, " +
            $"CAST({method} AS TEXT) AS method, CAST({status} AS INTEGER) AS status, level, " +
            "CAST(json_extract(properties, '$.\"Elapsed\"') AS REAL) AS ms" +
            $"{trendTs} " +
            $"FROM {source}), " +
            // ids folded out of the path, so /api/orders/41973 counts as /api/orders/{id} rather
            // than as an operation of its own (RoutePath explains what that was doing to the panel)
            $"w AS (SELECT tmpl, raw, fold_route(raw) AS route, method, status, level, ms{carryTs} FROM v), " +
            "k AS (SELECT " +
            // COALESCE, not method || ' ' || route: concatenating a NULL verb answers NULL, and an
            // outcome line has no verb to name. It gets the bare path, which is honestly all the
            // event said — and is what OperationName draws when a row comes back without a method.
            $"CASE WHEN {isRoute} THEN COALESCE(method || ' ' || route, route) ELSE tmpl END AS label, " +
            $"CASE WHEN {isRoute} THEN method END AS method, " +
            $"CASE WHEN {isRoute} THEN route END AS route, " +
            // whether this group had to be folded, so a deep link back to the events knows to
            // match the pattern instead of the literal path it no longer carries
            $"CASE WHEN {isRoute} AND route <> raw THEN 1 ELSE 0 END AS folded, " +
            "level, ms" +
            $"{carryTs} " +
            $"FROM w WHERE ({isRoute}) OR tmpl IS NOT NULL), " +
            "s AS (SELECT label, MAX(method) AS method, MAX(route) AS route, MAX(folded) AS folded, " +
            "COUNT(*) AS total, " +
            "SUM(CASE WHEN level IN ('Error', 'Fatal') THEN 1 ELSE 0 END) AS errors " +
            "FROM k GROUP BY label), " +
            "r AS (SELECT label, ms, ROW_NUMBER() OVER (PARTITION BY label ORDER BY ms) AS rn, " +
            "COUNT(*) OVER (PARTITION BY label) AS n FROM k WHERE ms IS NOT NULL), " +
            "p AS (SELECT label, MIN(ms) FILTER (WHERE rn >= 0.95 * n) AS p95 FROM r GROUP BY label) " +
            (wantsTrend
                // Only the rows that survive the LIMIT get a strip: the ORDER BY ... LIMIT at the
                // bottom cannot reach back into a CTE, so without `top` every group was bucketed
                // and JSON-encoded and then all but fifty thrown away. `top` orders exactly as the
                // final SELECT does, so it picks the same rows.
                // Worth having but not dramatic — measured over 3,000 template groups, the trend
                // cost +13ms on top of the query without it, and +9ms with this. SQLite is simply
                // good at grouping small sets; the saving is proportional to how far the group
                // count runs past the limit.
                ? ", top AS (SELECT label FROM s ORDER BY total DESC, label LIMIT @limit), " +
                  // one [bucket, count] pair per bucket the group actually has events in. Sparse on
                  // purpose: an idle route over 24 buckets is two numbers instead of twenty-four,
                  // and C# fills the gaps with zeroes anyway.
                  "b AS (SELECT k.label AS label, " +
                  "CAST((julianday(k.ts) - julianday(@from)) * 86400.0 / @bucketSeconds AS INTEGER) AS bi, " +
                  "COUNT(*) AS c FROM k JOIN top ON top.label = k.label GROUP BY k.label, bi), " +
                  "t AS (SELECT label, json_group_array(json_array(bi, c)) AS trend FROM b GROUP BY label) " +
                  "SELECT s.label, s.total, s.errors, p.p95, s.method, s.route, s.folded, t.trend " +
                  "FROM s LEFT JOIN p ON p.label = s.label LEFT JOIN t ON t.label = s.label " +
                  "ORDER BY s.total DESC, s.label LIMIT @limit;"
                : "SELECT s.label, s.total, s.errors, p.p95, s.method, s.route, s.folded, NULL AS trend " +
                  "FROM s LEFT JOIN p ON p.label = s.label " +
                  "ORDER BY s.total DESC, s.label LIMIT @limit;");
        command.Parameters.AddWithValue("@limit", limit);
        if (wantsTrend)
        {
            command.Parameters.AddWithValue("@bucketSeconds", BucketSeconds(fromUtc, toUtc, trendBuckets));
        }

        var rows = new List<OperationOverview>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new OperationOverview(
                reader.GetString(0), reader.GetInt64(1), reader.GetInt64(2),
                reader.IsDBNull(3) ? null : reader.GetDouble(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.GetInt64(6) != 0,
                wantsTrend && !reader.IsDBNull(7) ? ExpandTrend(reader.GetString(7), trendBuckets) : null));
        }
        return rows;
    }

    /// <summary>A stored ISO-8601 timestamp as an instant. The fixed format is ours, written by
    /// ClefParser.FormatTimestamp, so a failure to parse is a bug rather than bad input.</summary>
    private static DateTimeOffset ParseUtc(string timestamp) =>
        DateTimeOffset.Parse(timestamp, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal);

    /// <summary>
    /// One trend column's width in seconds, computed the way GetHistogramAsync computes it — same
    /// arithmetic, so a row's strip and the chart above it cut time at the same instants.
    /// </summary>
    /// <remarks>
    /// Epsilon rather than a zero guard: the API rejects to &lt;= from, but these are public store
    /// methods and a division by zero would silently put every event in one NULL bucket.
    /// </remarks>
    private static double BucketSeconds(string fromUtc, string toUtc, int buckets) =>
        Math.Max(double.Epsilon, (ParseUtc(toUtc) - ParseUtc(fromUtc)).TotalSeconds / buckets);

    /// <summary>
    /// The sparse [[bucket, count], ...] SQLite aggregated, widened to one number per bucket.
    /// </summary>
    /// <remarks>
    /// Out-of-range indices are clamped rather than dropped, for the same reason
    /// GetHistogramAsync clamps: an event landing exactly on `to` can float-round one bucket past
    /// the end, and losing it would make a row's strip disagree with its own total. A pair that is
    /// not two numbers is skipped instead of throwing — julianday() answers NULL for a timestamp
    /// it cannot read, and one unparseable row must not cost the whole response.
    /// </remarks>
    private static long[] ExpandTrend(string json, int buckets)
    {
        var counts = new long[buckets];
        using var document = JsonDocument.Parse(json);
        foreach (var pair in document.RootElement.EnumerateArray())
        {
            if (pair.ValueKind != JsonValueKind.Array || pair.GetArrayLength() < 2) continue;
            // ValueKind first: TryGetInt64 throws on anything that is not a Number, so it is no
            // guard on its own, and a NULL bucket index arrives here as JsonValueKind.Null
            if (pair[0].ValueKind != JsonValueKind.Number || pair[1].ValueKind != JsonValueKind.Number) continue;
            if (!pair[0].TryGetInt64(out var bucket) || !pair[1].TryGetInt64(out var count)) continue;
            counts[(int)Math.Clamp(bucket, 0, buckets - 1)] += count;
        }
        return counts;
    }

    public async Task<IReadOnlyList<UserActivity>> GetUserActivityAsync(
        QuerySql? filter, string fromUtc, string toUtc, string property, int limit,
        int trendBuckets = 0, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var wantsTrend = trendBuckets > 0;
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "level, properties, timestamp", fromUtc, toUtc, cancellationToken);

        // safe to embed: property is restricted to [A-Za-z0-9_.] at the API boundary; the quoted
        // step keeps dots literal. CAST AS TEXT so numeric ids group and display uniformly.
        //
        // The trend rides along for the same reason it does on the operations query: the Users
        // table draws one strip per row and there are fifty of them, which was fifty histogram
        // requests that could not start until this one had answered. See GetOperationOverviewAsync.
        command.CommandText =
            "WITH v AS (" +
            $"SELECT CAST(json_extract(properties, '$.\"{property}\"') AS TEXT) AS usr, level, timestamp " +
            $"FROM {source}), " +
            "s AS (SELECT usr, COUNT(*) AS total, " +
            "SUM(CASE WHEN level IN ('Error', 'Fatal') THEN 1 ELSE 0 END) AS errors, " +
            "MAX(timestamp) AS last_seen " +
            "FROM v WHERE usr IS NOT NULL GROUP BY usr) " +
            (wantsTrend
                // `top` first, so only the rows that survive the limit are bucketed and encoded
                ? ", top AS (SELECT usr FROM s ORDER BY total DESC, usr LIMIT @limit), " +
                  "b AS (SELECT v.usr AS usr, " +
                  "CAST((julianday(v.timestamp) - julianday(@from)) * 86400.0 / @bucketSeconds AS INTEGER) AS bi, " +
                  "COUNT(*) AS c FROM v JOIN top ON top.usr = v.usr GROUP BY v.usr, bi), " +
                  "t AS (SELECT usr, json_group_array(json_array(bi, c)) AS trend FROM b GROUP BY usr) " +
                  "SELECT s.usr, s.total, s.errors, s.last_seen, t.trend FROM s " +
                  "LEFT JOIN t ON t.usr = s.usr ORDER BY s.total DESC, s.usr LIMIT @limit;"
                : "SELECT s.usr, s.total, s.errors, s.last_seen, NULL AS trend FROM s " +
                  "ORDER BY s.total DESC, s.usr LIMIT @limit;");
        command.Parameters.AddWithValue("@limit", limit);
        if (wantsTrend)
        {
            command.Parameters.AddWithValue("@bucketSeconds", BucketSeconds(fromUtc, toUtc, trendBuckets));
        }

        var rows = new List<UserActivity>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new UserActivity(
                reader.GetString(0), reader.GetInt64(1), reader.GetInt64(2), reader.GetString(3),
                wantsTrend && !reader.IsDBNull(4) ? ExpandTrend(reader.GetString(4), trendBuckets) : null));
        }
        return rows;
    }

    public async Task<IReadOnlyList<QueryOverview>> GetQueryOverviewAsync(
        QuerySql? filter, string fromUtc, string toUtc,
        string property, string durationProperty, string connectionProperty, int limit,
        CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "level, properties, timestamp", fromUtc, toUtc, cancellationToken);

        // safe to embed: all three property names are restricted to [A-Za-z0-9_.] at the API
        // boundary; the quoted step keeps dots literal. p95 mirrors GetOperationOverviewAsync.
        command.CommandText =
            "WITH q AS (" +
            $"SELECT CAST(json_extract(properties, '$.\"{property}\"') AS TEXT) AS qry, " +
            $"CAST(json_extract(properties, '$.\"{durationProperty}\"') AS REAL) AS ms, " +
            $"CAST(json_extract(properties, '$.\"{connectionProperty}\"') AS TEXT) AS conn, " +
            "level, timestamp " +
            $"FROM {source}), " +
            "g AS (SELECT * FROM q WHERE qry IS NOT NULL), " +
            "s AS (SELECT qry, COUNT(*) AS calls, " +
            "SUM(CASE WHEN level IN ('Error', 'Fatal') THEN 1 ELSE 0 END) AS errors, " +
            "SUM(ms) AS total_ms, AVG(ms) AS avg_ms, MAX(conn) AS conn, MAX(timestamp) AS last_seen " +
            "FROM g GROUP BY qry), " +
            "r AS (SELECT qry, ms, ROW_NUMBER() OVER (PARTITION BY qry ORDER BY ms) AS rn, " +
            "COUNT(*) OVER (PARTITION BY qry) AS n FROM g WHERE ms IS NOT NULL), " +
            "p AS (SELECT qry, MIN(ms) FILTER (WHERE rn >= 0.95 * n) AS p95 FROM r GROUP BY qry) " +
            "SELECT s.qry, s.conn, s.calls, s.errors, s.total_ms, s.avg_ms, p.p95, s.last_seen " +
            "FROM s LEFT JOIN p ON p.qry = s.qry " +
            "ORDER BY (s.total_ms IS NULL), s.total_ms DESC, s.calls DESC, s.qry LIMIT @limit;";
        command.Parameters.AddWithValue("@limit", limit);

        var rows = new List<QueryOverview>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new QueryOverview(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetInt64(2), reader.GetInt64(3),
                reader.IsDBNull(4) ? null : reader.GetDouble(4),
                reader.IsDBNull(5) ? null : reader.GetDouble(5),
                reader.IsDBNull(6) ? null : reader.GetDouble(6),
                reader.GetString(7)));
        }
        return rows;
    }

    public async Task<SlowOperationsResult> GetSlowOperationsAsync(
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
        // shared prefix: SQLite CTEs do not span statements, so it is re-declared in both below
        var cte =
            "WITH v AS (" +
            $"SELECT message_template AS tmpl, CAST({extract} AS REAL) AS ms, " +
            "CASE WHEN timestamp < @split THEN 0 ELSE 1 END AS cur " +
            $"FROM {source} WHERE message_template IS NOT NULL AND {extract} IS NOT NULL), " +
            // ROW_NUMBER (not PERCENT_RANK) so a burst of equal durations doesn't collapse to rank 0
            "r AS (SELECT tmpl, cur, ms, " +
            "ROW_NUMBER() OVER (PARTITION BY tmpl, cur ORDER BY ms) AS rn, " +
            "COUNT(*) OVER (PARTITION BY tmpl, cur) AS n FROM v), " +
            "p AS (SELECT tmpl, cur, MAX(n) AS n, MIN(ms) FILTER (WHERE rn >= 0.95 * n) AS p95 " +
            "FROM r GROUP BY tmpl, cur) ";
        command.CommandText =
            cte +
            "SELECT b.tmpl, b.p95 AS base_p95, c.p95 AS cur_p95, c.n AS cur_n " +
            "FROM p b JOIN p c ON c.tmpl = b.tmpl AND b.cur = 0 AND c.cur = 1 " +
            "WHERE b.n >= @minSamples AND c.n >= @minSamples AND b.p95 >= @floorMs AND b.p95 > 0 " +
            "AND c.p95 >= b.p95 * @factor " +
            "ORDER BY c.p95 / b.p95 DESC, c.p95 DESC LIMIT @limit; " +
            // counts over the same CTE: timed = any current-window sample (not gated by minSamples);
            // comparable = >= minSamples in both windows (no floorMs/factor)
            cte +
            "SELECT (SELECT COUNT(*) FROM p WHERE cur = 1) AS timed, " +
            "(SELECT COUNT(*) FROM p b JOIN p c ON c.tmpl = b.tmpl AND b.cur = 0 AND c.cur = 1 " +
            "WHERE b.n >= @minSamples AND c.n >= @minSamples) AS comparable;";
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
        long timed = 0, comparable = 0;
        if (await reader.NextResultAsync(cancellationToken) && await reader.ReadAsync(cancellationToken))
        {
            timed = reader.GetInt64(0);
            comparable = reader.GetInt64(1);
        }
        return new SlowOperationsResult(rows, timed, comparable);
    }

    public async Task<IReadOnlyList<TopException>> GetTopExceptionsAsync(
        QuerySql? filter, string fromUtc, string toUtc, int limit, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "exception, timestamp", fromUtc, toUtc, cancellationToken);

        // exception type = first line up to ':' (whole first line when no colon); rtrim drops the \r of CRLF text.
        // The latest occurrence's full text rides along so the caller can surface its source location.
        command.CommandText =
            "WITH t AS (" +
            "SELECT CASE WHEN instr(first_line, ':') > 0 THEN substr(first_line, 1, instr(first_line, ':') - 1) " +
            "ELSE first_line END AS ex_type, timestamp, exception FROM (" +
            "SELECT rtrim(CASE WHEN instr(exception, char(10)) > 0 " +
            "THEN substr(exception, 1, instr(exception, char(10)) - 1) ELSE exception END, char(13)) AS first_line, " +
            $"timestamp, exception FROM {source} WHERE exception IS NOT NULL)), " +
            "g AS (SELECT ex_type, COUNT(*) AS cnt, MIN(timestamp) AS first_seen, MAX(timestamp) AS last_seen " +
            "FROM t GROUP BY ex_type), " +
            "s AS (SELECT ex_type, exception, " +
            "ROW_NUMBER() OVER (PARTITION BY ex_type ORDER BY timestamp DESC) AS rn FROM t) " +
            "SELECT g.ex_type, g.cnt, g.first_seen, g.last_seen, s.exception " +
            "FROM g JOIN s ON s.ex_type = g.ex_type AND s.rn = 1 " +
            "ORDER BY g.cnt DESC, g.ex_type LIMIT @limit;";
        command.Parameters.AddWithValue("@limit", limit);

        var rows = new List<TopException>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new TopException(
                reader.GetString(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3),
                ExceptionLocation.FromText(reader.GetString(4))));
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

    public async Task<IngestionLag> GetIngestionLagAsync(
        QuerySql? filter, string fromUtc, string toUtc, double lateAfterSeconds,
        CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "timestamp, ingested_at", fromUtc, toUtc, cancellationToken);

        // julianday reads our fixed-width ISO-8601 directly; * 86400 turns days into seconds.
        // Percentiles run over non-negative lag only: a client stamping events ahead of its own
        // arrival would otherwise pull p50 below zero and hide how late the genuinely late ones are.
        // ROW_NUMBER, not PERCENT_RANK, matching every other percentile in this file.
        command.CommandText =
            "WITH v AS (SELECT (julianday(ingested_at) - julianday(timestamp)) * 86400.0 AS lag " +
            $"FROM {source}), " +
            "p AS (SELECT lag FROM v WHERE lag >= 0), " +
            "r AS (SELECT lag, ROW_NUMBER() OVER (ORDER BY lag) AS rn, COUNT(*) OVER () AS n FROM p) " +
            "SELECT (SELECT COUNT(*) FROM v), " +
            "(SELECT COUNT(*) FROM v WHERE lag > @lateAfter), " +
            "(SELECT COUNT(*) FROM v WHERE lag < 0), " +
            "(SELECT MIN(lag) FILTER (WHERE rn >= 0.50 * n) FROM r), " +
            "(SELECT MIN(lag) FILTER (WHERE rn >= 0.95 * n) FROM r), " +
            "(SELECT MAX(lag) FROM p); " +
            // second result set: the single latest arrival, so the UI can point at it
            $"SELECT timestamp, ingested_at FROM {source} " +
            "ORDER BY (julianday(ingested_at) - julianday(timestamp)) DESC LIMIT 1;";
        command.Parameters.AddWithValue("@lateAfter", lateAfterSeconds);

        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return new IngestionLag(0, 0, 0, 0, 0, 0, null, null);
        }

        var total = reader.GetInt64(0);
        var late = reader.GetInt64(1);
        var skewed = reader.GetInt64(2);
        // NULL whenever no row had non-negative lag; an empty range reads as zero, not as missing
        var p50 = reader.IsDBNull(3) ? 0 : reader.GetDouble(3);
        var p95 = reader.IsDBNull(4) ? 0 : reader.GetDouble(4);
        var max = reader.IsDBNull(5) ? 0 : reader.GetDouble(5);

        string? worstTimestamp = null, worstIngestedAt = null;
        if (await reader.NextResultAsync(cancellationToken) && await reader.ReadAsync(cancellationToken))
        {
            worstTimestamp = reader.GetString(0);
            worstIngestedAt = reader.GetString(1);
        }
        return new IngestionLag(total, late, skewed, p50, p95, max, worstTimestamp, worstIngestedAt);
    }

    /// <summary>
    /// Builds the FROM source for stats aggregates: hot events only, or hot UNION ALL hydrated cache
    /// when the range touches hydrated segments (same pattern as QueryAsync, including the eviction
    /// touch). Binds @from/@to and the filter parameters onto <paramref name="command"/>.
    /// Every aggregate goes through here — one that does not is blind to extracted archive data.
    /// </summary>
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
        command.Parameters.AddWithValue("@prefix", SqlLike.Escape(prefix));
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
        command.Parameters.AddWithValue("@prefix", SqlLike.Escape(prefix));
        command.Parameters.AddWithValue("@limit", limit);
        return await ReadStringsAsync(command, cancellationToken);
    }

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
}
