using LogHarbor.Core.Events;

namespace LogHarbor.Tests.Events;

public class ServiceStatusTests
{
    private static readonly DateTimeOffset AsOf = DateTimeOffset.Parse("2026-07-25T09:20:00Z");

    private static ServiceStatusReading Reading(
        string service = "nginx",
        string host = "web-1",
        long? up = 1,
        string? state = "active",
        string? health = null,
        string lastSeen = "2026-07-25T09:19:30.0000000Z") =>
        new(host, "systemd", service, up, state, health, lastSeen);

    private static string StatusOf(ServiceStatusReading reading, int staleMinutes = 5) =>
        ServiceStatus.Evaluate([reading], AsOf, staleMinutes).Single().Status;

    [Fact]
    public void Evaluate_FreshHeartbeat_IsUp()
    {
        Assert.Equal("up", StatusOf(Reading()));
    }

    [Fact]
    public void Evaluate_FreshZero_IsDown()
    {
        Assert.Equal("down", StatusOf(Reading(up: 0, state: "inactive")));
    }

    [Fact]
    public void Evaluate_RunningButFailingItsHealthcheck_IsUnhealthy()
    {
        Assert.Equal("unhealthy", StatusOf(Reading(state: "running", health: "unhealthy")));
    }

    [Fact]
    public void Evaluate_HealthyContainer_IsUp()
    {
        Assert.Equal("up", StatusOf(Reading(state: "running", health: "healthy")));
    }

    // the probe emits a failure event with no `up` at all when it cannot ask
    // (docs/service-status.md); collapsing that into down would invent a false zero
    [Fact]
    public void Evaluate_ReadingWithoutUp_IsUnknownNotDown()
    {
        Assert.Equal("unknown", StatusOf(Reading(up: null, state: null)));
    }

    // an up=1 from an hour ago is not evidence that anything is up
    [Fact]
    public void Evaluate_OldHeartbeat_IsStaleEvenWhenItSaidUp()
    {
        Assert.Equal("stale", StatusOf(Reading(lastSeen: "2026-07-25T09:10:00.0000000Z")));
    }

    [Fact]
    public void Evaluate_ExactlyAtTheStaleBoundary_IsStillFresh()
    {
        Assert.Equal("up", StatusOf(Reading(lastSeen: "2026-07-25T09:15:00.0000000Z")));
    }

    [Fact]
    public void Evaluate_ReportsAgeInSeconds()
    {
        var row = ServiceStatus.Evaluate([Reading()], AsOf, 5).Single();
        Assert.Equal(30, row.SecondsSinceLastSeen);
        Assert.Equal("web-1", row.Host);
        Assert.Equal("nginx", row.Service);
        Assert.Equal("systemd", row.Kind);
        Assert.Equal("active", row.State);
    }

    // a reading from after the range end (clock skew between host and server) reads as
    // fresh, never as a negative age
    [Fact]
    public void Evaluate_ReadingFromTheFuture_IsFreshWithZeroAge()
    {
        var row = ServiceStatus.Evaluate([Reading(lastSeen: "2026-07-25T09:25:00.0000000Z")], AsOf, 5).Single();
        Assert.Equal("up", row.Status);
        Assert.Equal(0, row.SecondsSinceLastSeen);
    }

    [Fact]
    public void Evaluate_SortsBrokenFirstThenHostThenService()
    {
        var rows = ServiceStatus.Evaluate(
            [
                Reading(service: "cron", host: "web-2"),
                Reading(service: "redis", up: null, state: null),
                Reading(service: "api", state: "running", health: "unhealthy"),
                Reading(service: "ssh", lastSeen: "2026-07-25T08:00:00.0000000Z"),
                Reading(service: "db", up: 0, state: "exited"),
                Reading(service: "cron", host: "web-1"),
            ],
            AsOf, 5);

        Assert.Equal(
            ["db", "ssh", "api", "redis", "cron", "cron"],
            rows.Select(row => row.Service));
        // the two ups tie on status, so the host decides
        Assert.Equal(["web-1", "web-2"], rows.TakeLast(2).Select(row => row.Host));
    }

    [Fact]
    public void Evaluate_UnparseableTimestamp_IsStale()
    {
        Assert.Equal("stale", StatusOf(Reading(lastSeen: "not a timestamp")));
    }
}
