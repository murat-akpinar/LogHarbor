# Dead Man's Switch Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `silence` alert condition that fires a webhook when a signal that was previously alive goes quiet for a full window (dead cron / stalled consumer), alongside the existing `at-least` threshold condition.

**Architecture:** A `condition` discriminator column on `alert_rules` (default `at-least`, so existing rules are untouched) threaded through `AlertRule`, `SqliteAlertStore`, and `AlertEndpoints`; `AlertEvaluator` branches on it — `silence` fires when the window has zero matches AND the range from the rule's creation to the window start has at least one (proof of life). Frontend `AlertForm` gains a condition selector that hides the threshold field for silence.

**Tech Stack:** .NET 8 minimal API, SQLite, xUnit; React 18 + TypeScript strict, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-18-dead-mans-switch-design.md`. Read before Task 1.

## Global Constraints

- Backend: nullable enabled, warnings as errors, async all the way, DTOs are records, parameterized SQL only (rules.md).
- New migrations are numbered SQL files in `backend/LogHarbor.Api/Migrations/`; append new columns last so existing reader ordinals never shift (SqliteAlertStore's `payload_format` precedent).
- Condition values are exactly `at-least` and `silence`; `at-least` is the default everywhere.
- Frontend: TypeScript strict, no `any`; API calls only through `src/api/`; Tailwind, no per-component CSS; TR + EN i18n for all new strings (type parity enforced by TS).
- All code/comments/commits in English; commit first lines imperative, ≤ 72 chars, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Commit straight to `main`.
- Backend commands run from repo root (`dotnet test backend`); frontend commands from `frontend/`.

---

### Task 1: Persistence + API for the `condition` field

**Files:**
- Create: `backend/LogHarbor.Api/Migrations/010_alert_condition.sql`
- Modify: `backend/LogHarbor.Core/Storage/IAlertStore.cs` (AlertRule record + CreateAsync/UpdateAsync signatures)
- Modify: `backend/LogHarbor.Core/Storage/SqliteAlertStore.cs` (Columns, Create/Update SQL, AddRuleParameters, ReadRule, GetEnabledWithSignalAsync)
- Modify: `backend/LogHarbor.Api/Endpoints/AlertEndpoints.cs` (AlertRequest, Validate, create/update calls)
- Modify: `docs/api.md` (ALERTS section)
- Test: `backend/LogHarbor.Tests/Api/AlertEndpointsTests.cs`

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 2 & 3 rely on these): `AlertRule` gains a final positional field `string Condition`; `IAlertStore.CreateAsync`/`UpdateAsync` gain a `string condition` parameter after `payloadFormat`; the API accepts/returns a `condition` field (default `"at-least"`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/LogHarbor.Tests/Api/AlertEndpointsTests.cs` (inside the class):

```csharp
    [Fact]
    public async Task OmittedCondition_DefaultsToAtLeast()
    {
        var response = await CreateAlertAsync(await CreateSignalAsync(), new { });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("at-least", created.GetProperty("condition").GetString());
    }

    [Fact]
    public async Task SilenceCondition_WithZeroThreshold_RoundTrips()
    {
        var response = await CreateAlertAsync(
            await CreateSignalAsync(), new { condition = "silence", thresholdCount = 0 });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("silence",
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("condition").GetString());

        var listed = await _client.GetFromJsonAsync<JsonElement>("/api/alerts");
        Assert.Equal("silence", listed.EnumerateArray().Single().GetProperty("condition").GetString());
    }

    [Fact]
    public async Task UnknownCondition_IsRejected()
    {
        var response = await CreateAlertAsync(await CreateSignalAsync(), new { condition = "whenever" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("condition", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task AtLeastCondition_WithZeroThreshold_IsRejected()
    {
        var response = await CreateAlertAsync(await CreateSignalAsync(), new { thresholdCount = 0 });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("thresholdCount", await response.Content.ReadAsStringAsync());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test backend --filter FullyQualifiedName~AlertEndpointsTests`
Expected: the four new tests FAIL — `OmittedCondition_DefaultsToAtLeast` because the response has no `condition` property (KeyNotFound), `SilenceCondition_WithZeroThreshold_RoundTrips` because zero threshold is rejected today, etc.

- [ ] **Step 3: Add the migration**

Create `backend/LogHarbor.Api/Migrations/010_alert_condition.sql`:

```sql
-- 010: alert condition: 'at-least' (fire on >= threshold, the existing behavior and
-- default) or 'silence' (dead man's switch: fire when a once-alive signal goes quiet).
-- Appended last so SqliteAlertStore reader ordinals do not shift (docs/api.md ALERTS).

ALTER TABLE alert_rules ADD COLUMN condition TEXT NOT NULL DEFAULT 'at-least';
```

- [ ] **Step 4: Thread Condition through the record and store interface**

In `backend/LogHarbor.Core/Storage/IAlertStore.cs`, add `Condition` as the final field of `AlertRule`:

```csharp
public sealed record AlertRule(
    long Id,
    string Title,
    long SignalId,
    int ThresholdCount,
    int WindowMinutes,
    string WebhookUrl,
    bool IsEnabled,
    string CreatedAt,
    string? LastTriggeredAt,
    string? LastError,
    string PayloadFormat,
    string Condition);
```

In the same file, add a `string condition` parameter (after `payloadFormat`) to both signatures:

```csharp
    Task<AlertRule> CreateAsync(
        string title, long signalId, int thresholdCount, int windowMinutes, string webhookUrl,
        bool isEnabled, string payloadFormat, string condition, CancellationToken cancellationToken = default);
```

```csharp
    Task<AlertRule?> UpdateAsync(
        long id, string title, long signalId, int thresholdCount, int windowMinutes, string webhookUrl,
        bool isEnabled, string payloadFormat, string condition, CancellationToken cancellationToken = default);
```

- [ ] **Step 5: Implement the store changes**

In `backend/LogHarbor.Core/Storage/SqliteAlertStore.cs`:

Extend `Columns` (append `condition` last):

```csharp
    private const string Columns =
        "id, title, signal_id, threshold_count, window_minutes, webhook_url, is_enabled, " +
        "created_at, last_triggered_at, last_error, payload_format, condition";
```

`CreateAsync` — update the signature, the INSERT, `AddRuleParameters` call, and the returned record:

```csharp
    public async Task<AlertRule> CreateAsync(
        string title, long signalId, int thresholdCount, int windowMinutes, string webhookUrl,
        bool isEnabled, string payloadFormat, string condition, CancellationToken cancellationToken = default)
    {
        var createdAt = ClefParser.FormatTimestamp(DateTimeOffset.UtcNow);

        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO alert_rules (title, signal_id, threshold_count, window_minutes, webhook_url, is_enabled, payload_format, condition, created_at) " +
            "VALUES (@title, @signalId, @threshold, @window, @webhookUrl, @isEnabled, @payloadFormat, @condition, @createdAt); " +
            "SELECT last_insert_rowid();";
        AddRuleParameters(command, title, signalId, thresholdCount, windowMinutes, webhookUrl, isEnabled, payloadFormat, condition);
        command.Parameters.AddWithValue("@createdAt", createdAt);

        long id;
        try
        {
            id = (long)(await command.ExecuteScalarAsync(cancellationToken))!;
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == UniqueConstraintCode)
        {
            throw new DuplicateAlertTitleException(title);
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == ForeignKeyConstraintCode)
        {
            throw new UnknownSignalException(signalId);
        }

        return new AlertRule(id, title, signalId, thresholdCount, windowMinutes, webhookUrl, isEnabled,
            createdAt, LastTriggeredAt: null, LastError: null, payloadFormat, condition);
    }
```

`UpdateAsync` — update the signature, the SET clause, and the `AddRuleParameters` call:

```csharp
    public async Task<AlertRule?> UpdateAsync(
        long id, string title, long signalId, int thresholdCount, int windowMinutes, string webhookUrl,
        bool isEnabled, string payloadFormat, string condition, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE alert_rules SET title = @title, signal_id = @signalId, threshold_count = @threshold, " +
            "window_minutes = @window, webhook_url = @webhookUrl, is_enabled = @isEnabled, " +
            "payload_format = @payloadFormat, condition = @condition " +
            $"WHERE id = @id RETURNING {Columns};";
        AddRuleParameters(command, title, signalId, thresholdCount, windowMinutes, webhookUrl, isEnabled, payloadFormat, condition);
        command.Parameters.AddWithValue("@id", id);

        try
        {
            using var reader = await command.ExecuteReaderAsync(cancellationToken);
            return await reader.ReadAsync(cancellationToken) ? ReadRule(reader) : null;
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == UniqueConstraintCode)
        {
            throw new DuplicateAlertTitleException(title);
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == ForeignKeyConstraintCode)
        {
            throw new UnknownSignalException(signalId);
        }
    }
```

`GetEnabledWithSignalAsync` — add `r.condition` right after `r.payload_format` (ordinal 11); the joined signal columns shift to 12 and 13:

```csharp
        command.CommandText =
            "SELECT r.id, r.title, r.signal_id, r.threshold_count, r.window_minutes, r.webhook_url, " +
            "r.is_enabled, r.created_at, r.last_triggered_at, r.last_error, r.payload_format, r.condition, " +
            "s.title, s.filter " +
            "FROM alert_rules r JOIN signals s ON s.id = r.signal_id " +
            "WHERE r.is_enabled = 1 ORDER BY r.id;";

        var alerts = new List<EnabledAlert>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            alerts.Add(new EnabledAlert(ReadRule(reader), reader.GetString(12), reader.GetString(13)));
        }
        return alerts;
```

`AddRuleParameters` — add the `condition` parameter:

```csharp
    private static void AddRuleParameters(
        SqliteCommand command, string title, long signalId, int thresholdCount, int windowMinutes,
        string webhookUrl, bool isEnabled, string payloadFormat, string condition)
    {
        command.Parameters.AddWithValue("@title", title);
        command.Parameters.AddWithValue("@signalId", signalId);
        command.Parameters.AddWithValue("@threshold", thresholdCount);
        command.Parameters.AddWithValue("@window", windowMinutes);
        command.Parameters.AddWithValue("@webhookUrl", webhookUrl);
        command.Parameters.AddWithValue("@isEnabled", isEnabled ? 1 : 0);
        command.Parameters.AddWithValue("@payloadFormat", payloadFormat);
        command.Parameters.AddWithValue("@condition", condition);
    }
```

`ReadRule` — read the new ordinal 11:

```csharp
    private static AlertRule ReadRule(SqliteDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.GetInt64(2),
        reader.GetInt32(3),
        reader.GetInt32(4),
        reader.GetString(5),
        reader.GetInt64(6) == 1,
        reader.GetString(7),
        reader.IsDBNull(8) ? null : reader.GetString(8),
        reader.IsDBNull(9) ? null : reader.GetString(9),
        reader.GetString(10),
        reader.GetString(11));
```

- [ ] **Step 6: Update the endpoint request + validation**

In `backend/LogHarbor.Api/Endpoints/AlertEndpoints.cs`:

Add the allowed conditions constant next to `PayloadFormats`:

```csharp
    private static readonly string[] Conditions = ["at-least", "silence"];
```

Add `Condition` to the request record:

```csharp
    public sealed record AlertRequest(
        string? Title, long? SignalId, int? ThresholdCount, int? WindowMinutes, string? WebhookUrl, bool? IsEnabled,
        string? PayloadFormat, string? Condition);
```

In the POST handler's `CreateAsync` call and the PUT handler's `UpdateAsync` call, pass the threshold default and the condition (the two calls are otherwise unchanged — update both):

```csharp
                var created = await store.CreateAsync(
                    request.Title!.Trim(), request.SignalId!.Value, request.ThresholdCount ?? 0,
                    request.WindowMinutes!.Value, request.WebhookUrl!, request.IsEnabled ?? true,
                    request.PayloadFormat ?? "generic", request.Condition ?? "at-least", cancellationToken);
```

```csharp
                var updated = await store.UpdateAsync(
                    id, request.Title!.Trim(), request.SignalId!.Value, request.ThresholdCount ?? 0,
                    request.WindowMinutes!.Value, request.WebhookUrl!, request.IsEnabled ?? true,
                    request.PayloadFormat ?? "generic", request.Condition ?? "at-least", cancellationToken);
```

Replace the threshold check in `Validate` and add the condition check. The current block is:

```csharp
        if (request.ThresholdCount is not >= 1)
        {
            errors["thresholdCount"] = ["Must be at least 1."];
        }
```

Replace it with (condition-aware — `at-least` still requires ≥ 1; `silence` ignores the threshold):

```csharp
        var condition = request.Condition ?? "at-least";
        if (!Conditions.Contains(condition))
        {
            errors["condition"] = [$"Must be one of: {string.Join(", ", Conditions)}."];
        }
        if (condition == "at-least" && request.ThresholdCount is not >= 1)
        {
            errors["thresholdCount"] = ["Must be at least 1."];
        }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `dotnet test backend --filter FullyQualifiedName~AlertEndpointsTests`
Expected: PASS (all, including the three pre-existing payload-format tests).

- [ ] **Step 8: Update the API docs**

In `docs/api.md`, ALERTS section: change the intro line and the GET/POST shapes and add the silence semantics + payload. Replace lines 111–126 with:

```
Evaluated once a minute. An `at-least` rule (the default) fires a webhook POST when a
signal matches at least thresholdCount events within the trailing windowMinutes. A
`silence` rule (dead man's switch) fires when the signal matched at least once between
the rule's creation and the start of the window, but zero events within the window —
a once-alive heartbeat that stopped.

GET    /api/alerts        200: [ { id, title, signalId, thresholdCount, windowMinutes, webhookUrl,
                                    isEnabled, createdAt, lastTriggeredAt, lastError, payloadFormat,
                                    condition } ]
POST   /api/alerts        body { title, signalId, thresholdCount, windowMinutes, webhookUrl, isEnabled,
                                 payloadFormat?, condition? }
                          201: AlertRule | 400 validation | 400 duplicate title | 400 unknown signal
PUT    /api/alerts/{id}   same body  200: AlertRule | 404 | 400 (as above)
DELETE /api/alerts/{id}   204 | 404

condition is 'at-least' (default; thresholdCount must be >= 1) or 'silence' (thresholdCount
is ignored and may be 0). webhookUrl must be an absolute http(s) URL (never a file path or
other local scheme). After firing (successfully or not) a rule cools down for one full
windowMinutes before it can retrigger, so a dead webhook is not hammered every evaluation
pass; a silence rule therefore re-fires once per window while the signal stays quiet.
payloadFormat picks the webhook body shape (default generic):
  generic (at-least)  { rule, signal, filter, count, threshold, windowMinutes, from, to }
  generic (silence)   { rule, signal, filter, condition: "silence", count: 0, windowMinutes, from, to }
  slack    { "text": "LogHarbor alert '<rule>': ..." }
  discord  { "content": same message }   (paste a Slack/Discord incoming-webhook
                                          URL as webhookUrl and pick its format)
```

- [ ] **Step 9: Commit**

```bash
git add backend/LogHarbor.Api/Migrations/010_alert_condition.sql backend/LogHarbor.Core/Storage/IAlertStore.cs backend/LogHarbor.Core/Storage/SqliteAlertStore.cs backend/LogHarbor.Api/Endpoints/AlertEndpoints.cs backend/LogHarbor.Tests/Api/AlertEndpointsTests.cs docs/api.md
git commit -m "feat(alerts): persist and validate a rule condition field

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Silence evaluation in AlertEvaluator

**Files:**
- Modify: `backend/LogHarbor.Core/Alerting/AlertEvaluator.cs`
- Test: `backend/LogHarbor.Tests/Alerting/AlertEvaluatorTests.cs`

**Interfaces:**
- Consumes: `AlertRule.Condition` (Task 1); `IEventStore.GetSummaryAsync(QuerySql?, string fromUtc, string toUtc, CancellationToken)` returning `StatsSummary` with a `long Total`; `IEventStore.WriteBatchAsync(IReadOnlyList<Event>, CancellationToken)`; `Event` positional record `(long Id, string Timestamp, string Level, string Message, string? MessageTemplate, string? Properties, string? Exception, string IngestedAt, ...)`.
- Produces: nothing consumed later.

**Note on the test design:** `created_at` is wall-clock (set inside `CreateAsync`), and HTTP ingestion clamps future timestamps, so the fire path is seeded via `IEventStore.WriteBatchAsync` (which does not clamp) at a timestamp computed relative to the created rule's `createdAt`, and `EvaluateAsync` is called with an explicit future `now`. This keeps the proof-of-life window `(created_at, now - window)` non-empty deterministically.

- [ ] **Step 1: Write the failing tests**

Add these helpers and tests to `backend/LogHarbor.Tests/Alerting/AlertEvaluatorTests.cs` (inside the class; they reuse the existing `_factory`, `_client`, `_sender`). Add `using LogHarbor.Core.Events;` to the file's usings if not present.

```csharp
    /// <summary>A signal on Error events and a silence rule over it; returns (signalId, createdAt).</summary>
    private async Task<(long SignalId, DateTimeOffset CreatedAt)> ArrangeSilenceRuleAsync(int windowMinutes = 5)
    {
        var signal = await _client.PostAsJsonAsync(
            "/api/signals", new { title = "errors", filter = "@Level = 'Error'" });
        Assert.Equal(HttpStatusCode.Created, signal.StatusCode);
        var signalId = (await signal.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();

        var alert = await _client.PostAsJsonAsync("/api/alerts", new
        {
            title = "dead-cron",
            signalId,
            thresholdCount = 0,
            windowMinutes,
            webhookUrl = "https://example.com/hook",
            isEnabled = true,
            condition = "silence",
        });
        Assert.Equal(HttpStatusCode.Created, alert.StatusCode);
        var createdAt = DateTimeOffset.Parse(
            (await alert.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("createdAt").GetString()!);
        return (signalId, createdAt);
    }

    private async Task SeedErrorAtAsync(DateTimeOffset when)
    {
        var events = _factory.Services.GetRequiredService<IEventStore>();
        var ts = ClefParser.FormatTimestamp(when);
        await events.WriteBatchAsync([new Event(0, ts, "Error", "boom", null, null, null, ts)]);
    }

    private AlertEvaluator NewEvaluator() => new(
        _factory.Services.GetRequiredService<IAlertStore>(),
        _factory.Services.GetRequiredService<IEventStore>(),
        _sender);

    [Fact]
    public async Task Silence_FiresWhenAOnceAliveSignalGoesQuiet()
    {
        var (_, createdAt) = await ArrangeSilenceRuleAsync(windowMinutes: 5);
        // proof of life 30s after creation; well before the silence window
        await SeedErrorAtAsync(createdAt.AddSeconds(30));

        // now = createdAt + 6 min: silence window (createdAt+1m, createdAt+6m) is empty,
        // proof window (createdAt, createdAt+1m) holds the seeded event
        var fired = await NewEvaluator().EvaluateAsync(createdAt.AddMinutes(6));

        Assert.Equal(1, fired);
        var (_, payload) = Assert.Single(_sender.Sent);
        var json = JsonSerializer.Deserialize<JsonElement>(payload);
        Assert.Equal("silence", json.GetProperty("condition").GetString());
        Assert.Equal(0, json.GetProperty("count").GetInt64());
    }

    [Fact]
    public async Task Silence_DoesNotFireWithoutProofOfLife()
    {
        var (_, createdAt) = await ArrangeSilenceRuleAsync(windowMinutes: 5);
        // no event ever matched the signal

        var fired = await NewEvaluator().EvaluateAsync(createdAt.AddMinutes(6));

        Assert.Equal(0, fired);
        Assert.Empty(_sender.Sent);
    }

    [Fact]
    public async Task Silence_DoesNotFireWhenTheWindowHasEvents()
    {
        var (_, createdAt) = await ArrangeSilenceRuleAsync(windowMinutes: 5);
        await SeedErrorAtAsync(createdAt.AddSeconds(30));       // proof of life
        await SeedErrorAtAsync(createdAt.AddMinutes(5).AddSeconds(30)); // inside the silence window

        var fired = await NewEvaluator().EvaluateAsync(createdAt.AddMinutes(6));

        Assert.Equal(0, fired);
        Assert.Empty(_sender.Sent);
    }

    [Fact]
    public async Task Silence_RespectsTheOneWindowCooldown()
    {
        var (_, createdAt) = await ArrangeSilenceRuleAsync(windowMinutes: 5);
        await SeedErrorAtAsync(createdAt.AddSeconds(30));

        Assert.Equal(1, await NewEvaluator().EvaluateAsync(createdAt.AddMinutes(6)));
        // one minute later, still within the cooldown window since the last firing
        Assert.Equal(0, await NewEvaluator().EvaluateAsync(createdAt.AddMinutes(7)));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test backend --filter FullyQualifiedName~AlertEvaluatorTests`
Expected: the new silence tests FAIL because the condition is not handled yet — today a silence rule runs the `at-least` path with threshold 0, so `windowCount < 0` is always false and it fires unconditionally with a generic payload that has no `condition` key. Concretely: `Silence_FiresWhenAOnceAliveSignalGoesQuiet` throws KeyNotFound on `GetProperty("condition")`; `Silence_DoesNotFireWithoutProofOfLife` and `Silence_DoesNotFireWhenTheWindowHasEvents` fire (1) instead of the expected 0. (`Silence_RespectsTheOneWindowCooldown` may pass early since cooldown already exists — that is fine; the other three prove the gap.)

- [ ] **Step 3: Implement silence evaluation**

In `backend/LogHarbor.Core/Alerting/AlertEvaluator.cs`, replace the body of the `foreach` loop in `EvaluateAsync` (the part from `var summary = ...` through `MarkTriggeredAsync`) so it branches on condition. The full loop becomes:

```csharp
        foreach (var (rule, signalTitle, signalFilter) in await _alerts.GetEnabledWithSignalAsync(cancellationToken))
        {
            var toUtc = ClefParser.FormatTimestamp(now);
            var fromUtc = ClefParser.FormatTimestamp(now.AddMinutes(-rule.WindowMinutes));
            if (rule.LastTriggeredAt is not null && string.CompareOrdinal(rule.LastTriggeredAt, fromUtc) > 0)
            {
                continue; // still cooling down
            }

            QuerySql filterSql;
            try
            {
                filterSql = SqlTranslator.Translate(QueryParser.Parse(signalFilter));
            }
            catch (QueryParseException ex)
            {
                // the signal was edited into something unparseable after the rule was created
                await _alerts.SetErrorAsync(rule.Id, $"invalid signal filter: {ex.Message}", cancellationToken);
                continue;
            }

            var windowCount = (await _events.GetSummaryAsync(filterSql, fromUtc, toUtc, cancellationToken)).Total;

            long count;
            if (rule.Condition == "silence")
            {
                if (windowCount > 0)
                {
                    continue; // still alive
                }
                // proof of life: was the signal ever seen between rule creation and the window?
                var prior = await _events.GetSummaryAsync(filterSql, rule.CreatedAt, fromUtc, cancellationToken);
                if (prior.Total == 0)
                {
                    continue; // never alive (or younger than one window) -> nothing to mourn
                }
                count = 0;
            }
            else
            {
                if (windowCount < rule.ThresholdCount)
                {
                    continue;
                }
                count = windowCount;
            }

            var payload = BuildPayload(rule, signalTitle, signalFilter, count, fromUtc, toUtc);

            var error = await _webhooks.SendAsync(rule.WebhookUrl, payload, cancellationToken);
            await _alerts.MarkTriggeredAsync(rule.Id, toUtc, error, cancellationToken);
            if (error is null)
            {
                fired++;
            }
        }
```

Then update `BuildPayload` to branch on condition, and add a silence message builder. Replace the existing `BuildPayload` and `BuildMessage` with:

```csharp
    /// <summary>Slack and Discord incoming webhooks reject arbitrary JSON — they require
    /// {"text"} / {"content"} respectively; everything else gets the structured payload.
    /// A silence payload carries condition:"silence" and count:0 instead of a threshold.</summary>
    private static string BuildPayload(
        AlertRule rule, string signalTitle, string signalFilter, long count, string fromUtc, string toUtc)
    {
        var message = rule.Condition == "silence"
            ? BuildSilenceMessage(rule, signalTitle)
            : BuildMessage(rule, signalTitle, count);

        switch (rule.PayloadFormat)
        {
            case "slack":
                return JsonSerializer.Serialize(new { text = message }, PayloadOptions);
            case "discord":
                return JsonSerializer.Serialize(new { content = message }, PayloadOptions);
            default:
                return rule.Condition == "silence"
                    ? JsonSerializer.Serialize(new
                    {
                        rule = rule.Title,
                        signal = signalTitle,
                        filter = signalFilter,
                        condition = "silence",
                        count,
                        windowMinutes = rule.WindowMinutes,
                        from = fromUtc,
                        to = toUtc,
                    }, PayloadOptions)
                    : JsonSerializer.Serialize(new
                    {
                        rule = rule.Title,
                        signal = signalTitle,
                        filter = signalFilter,
                        count,
                        threshold = rule.ThresholdCount,
                        windowMinutes = rule.WindowMinutes,
                        from = fromUtc,
                        to = toUtc,
                    }, PayloadOptions);
        }
    }

    private static string BuildMessage(AlertRule rule, string signalTitle, long count) =>
        $"LogHarbor alert '{rule.Title}': {count} events matched '{signalTitle}' " +
        $"in the last {rule.WindowMinutes} min (threshold {rule.ThresholdCount}).";

    private static string BuildSilenceMessage(AlertRule rule, string signalTitle) =>
        $"LogHarbor alert '{rule.Title}': signal '{signalTitle}' has been silent for " +
        $"{rule.WindowMinutes} min (expected at least one event).";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `dotnet test backend --filter FullyQualifiedName~AlertEvaluatorTests`
Expected: PASS (all, including the three pre-existing format tests).

- [ ] **Step 5: Run the full backend suite**

Run: `dotnet test backend`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/LogHarbor.Core/Alerting/AlertEvaluator.cs backend/LogHarbor.Tests/Alerting/AlertEvaluatorTests.cs
git commit -m "feat(alerts): silence condition evaluation (dead man's switch)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend condition selector + i18n + docs

**Files:**
- Modify: `frontend/src/types/index.ts` (AlertCondition + AlertRule.condition)
- Modify: `frontend/src/api/alerts.ts` (AlertRequest.condition)
- Modify: `frontend/src/components/AlertForm.tsx` (condition select, hide threshold, window label)
- Modify: `frontend/src/pages/AlertsPage.tsx` (summary branches on condition)
- Modify: `frontend/src/i18n/en.ts`, `frontend/src/i18n/tr.ts`
- Modify: `docs/frontend.md` (ALERTS PAGE)
- Test: `frontend/src/components/AlertForm.test.tsx`

**Interfaces:**
- Consumes: the API `condition` field (Task 1); `AlertRequest` shape.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/AlertForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '../i18n'
import { AlertForm } from './AlertForm'

vi.mock('../hooks/useSignals', () => ({
  useSignals: () => ({ data: [{ id: 1, title: 'errors', filter: "@Level = 'Error'", createdAt: '' }] }),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

function renderForm(onSubmit: (request: unknown) => Promise<unknown>) {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <AlertForm submitLabel="Create" onSubmit={onSubmit} />
    </LanguageProvider>,
  )
}

it('hides the threshold field for a silence rule and submits condition silence', async () => {
  const onSubmit = vi.fn(async () => ({}))
  renderForm(onSubmit)

  // at-least is the default, so the threshold field is present
  expect(screen.getByPlaceholderText('Count')).toBeDefined()

  // combobox order: [condition, signal, payload format]
  const combos = screen.getAllByRole('combobox')
  fireEvent.change(combos[1], { target: { value: '1' } })          // signal
  fireEvent.change(combos[0], { target: { value: 'silence' } })    // condition

  expect(screen.queryByPlaceholderText('Count')).toBeNull()

  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'dead-cron' } })
  fireEvent.change(screen.getByPlaceholderText('https://example.com/webhook'), {
    target: { value: 'https://x.test/hook' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))

  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ condition: 'silence', thresholdCount: 0, signalId: 1 }),
    ),
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/components/AlertForm.test.tsx`
Expected: FAIL — there is no condition `<combobox>` yet (`combos[0]`/`combos[1]` are the signal/payload selects, so selecting `'silence'` on the wrong one does nothing and the threshold field stays visible / condition is not submitted).

- [ ] **Step 3: Add the types**

In `frontend/src/types/index.ts`, add the condition union above `AlertRule` and the field to `AlertRule`:

```ts
export type AlertCondition = 'at-least' | 'silence'
```

In the `AlertRule` interface, add after `payloadFormat: AlertPayloadFormat`:

```ts
  condition: AlertCondition
```

In `frontend/src/api/alerts.ts`, import the type and add the field to `AlertRequest`:

```ts
import type { AlertCondition, AlertPayloadFormat, AlertRule } from '../types'
```

```ts
export interface AlertRequest {
  title: string
  signalId: number
  thresholdCount: number
  windowMinutes: number
  webhookUrl: string
  isEnabled: boolean
  payloadFormat: AlertPayloadFormat
  condition: AlertCondition
}
```

- [ ] **Step 4: Add the i18n strings**

In `frontend/src/i18n/en.ts`, inside the `alerts` block: change `description`, add the condition/silence keys, and add `summarySilence` next to `summary`:

```ts
    description:
      'Fires a webhook POST when a signal matches at least the threshold count of events in the window (at-least), or when a once-active signal goes silent for the whole window (dead man’s switch).',
```

Add these keys inside the same `alerts` block:

```ts
    summarySilence: (signalTitle: string, windowMinutes: number) =>
      `${signalTitle} — fires when silent for ${windowMinutes}min →`,
    conditionTitle: 'Alert condition',
    conditionAtLeast: 'At least N events',
    conditionSilence: 'Silent for N minutes',
    silenceWindowTitle: 'Silence period (minutes)',
```

In `frontend/src/i18n/tr.ts`, inside the `alerts` block, mirror them:

```ts
    description:
      'Bir sinyal, pencere içinde en az eşik sayısı kadar olayla eşleştiğinde (en-az) ya da bir zamanlar etkin olan bir sinyal tüm pencere boyunca sustuğunda (dead man’s switch) bir webhook POST isteği gönderir.',
```

```ts
    summarySilence: (signalTitle: string, windowMinutes: number) =>
      `${signalTitle} — ${windowMinutes} dk sessiz kalınca tetiklenir →`,
    conditionTitle: 'Uyarı koşulu',
    conditionAtLeast: 'En az N olay',
    conditionSilence: 'N dakika sessiz',
    silenceWindowTitle: 'Sessizlik süresi (dakika)',
```

- [ ] **Step 5: Update AlertForm**

In `frontend/src/components/AlertForm.tsx`:

Add `condition: 'at-least'` to `DEFAULTS`:

```ts
const DEFAULTS: AlertRequest = {
  title: '',
  signalId: 0,
  thresholdCount: 1,
  windowMinutes: 5,
  webhookUrl: '',
  isEnabled: true,
  payloadFormat: 'generic',
  condition: 'at-least',
}
```

Add a condition `<select>` immediately after the title `<Input>` (so combobox DOM order is condition, signal, payload format). When switching to `silence`, force `thresholdCount` to 0; when switching back, restore it to at least 1:

```tsx
        <Select
          value={form.condition}
          onChange={(event) => {
            const condition = event.target.value as AlertRequest['condition']
            setForm((current) => ({
              ...current,
              condition,
              thresholdCount: condition === 'silence' ? 0 : current.thresholdCount || 1,
            }))
          }}
          title={t.alerts.conditionTitle}
          disabled={isSubmitting}
        >
          <option value="at-least">{t.alerts.conditionAtLeast}</option>
          <option value="silence">{t.alerts.conditionSilence}</option>
        </Select>
```

Wrap the threshold `<Input>` (the one with `placeholder={t.alerts.countPlaceholder}`) so it only renders for `at-least`:

```tsx
        {form.condition === 'at-least' && (
          <Input
            type="number"
            min={1}
            value={form.thresholdCount}
            onChange={(event) => setForm((current) => ({ ...current, thresholdCount: Number(event.target.value) }))}
            placeholder={t.alerts.countPlaceholder}
            title={t.alerts.thresholdTitle}
            className="w-20"
            disabled={isSubmitting}
          />
        )}
```

Make the window `<Input>`'s `title` reflect the condition (change only the `title` prop):

```tsx
          title={form.condition === 'silence' ? t.alerts.silenceWindowTitle : t.alerts.windowTitle}
```

- [ ] **Step 6: Update the AlertsPage row summary**

In `frontend/src/pages/AlertsPage.tsx`, in `AlertRow`, replace the summary call:

```tsx
            {alert.condition === 'silence'
              ? t.alerts.summarySilence(signalTitle, alert.windowMinutes)
              : t.alerts.summary(signalTitle, alert.thresholdCount, alert.windowMinutes)}{' '}
```

- [ ] **Step 7: Run the test to verify it passes**

Run (from `frontend/`): `npx vitest run src/components/AlertForm.test.tsx`
Expected: PASS.

- [ ] **Step 8: Run the full frontend suite and build**

Run (from `frontend/`): `npx vitest run` — Expected: PASS, all files.
Run (from `frontend/`): `npm run build` — Expected: tsc + vite succeed with no errors.

- [ ] **Step 9: Update the frontend docs**

In `docs/frontend.md`, ALERTS PAGE section, append after the existing description:

```
Condition selector: "at least N events" (threshold) or "silent for N minutes" (dead
man's switch). Choosing silence hides the threshold field (sent as 0) and relabels the
window as the silence period; the rule row summary reads "fires when silent for Nmin".
```

Then mark the todo item done in `todo.md` (gitignored — no commit): the Phase 14 A "Dead man's switch alerts" line to `[x]` with a DONE note pointing at the spec.

- [ ] **Step 10: Commit**

```bash
git add src/types/index.ts src/api/alerts.ts src/components/AlertForm.tsx src/components/AlertForm.test.tsx src/pages/AlertsPage.tsx src/i18n/en.ts src/i18n/tr.ts ../docs/frontend.md
git commit -m "feat(alerts): condition selector for dead man's switch rules

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
