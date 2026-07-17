using System.Diagnostics.Metrics;

namespace LogHarbor.Tests.Telemetry;

/// <summary>Captures every measurement from the "LogHarbor" meter while alive. The meter is
/// process-global and test classes run in parallel, so assertions should match on
/// distinctive values/tags rather than expecting to be the only producer.</summary>
public sealed class MeterCapture : IDisposable
{
    private readonly MeterListener _listener = new();
    private readonly List<(string Instrument, double Value, string? Source)> _measurements = [];

    public MeterCapture()
    {
        _listener.InstrumentPublished = (instrument, listener) =>
        {
            if (instrument.Meter.Name == "LogHarbor")
            {
                listener.EnableMeasurementEvents(instrument);
            }
        };
        _listener.SetMeasurementEventCallback<long>((instrument, value, tags, _) => Record(instrument, value, tags));
        _listener.SetMeasurementEventCallback<double>((instrument, value, tags, _) => Record(instrument, value, tags));
        _listener.Start();
    }

    public IReadOnlyList<(string Instrument, double Value, string? Source)> Measurements
    {
        get
        {
            lock (_measurements)
            {
                return _measurements.ToList();
            }
        }
    }

    private void Record(Instrument instrument, double value, ReadOnlySpan<KeyValuePair<string, object?>> tags)
    {
        string? source = null;
        foreach (var tag in tags)
        {
            if (tag.Key == "source")
            {
                source = tag.Value?.ToString();
            }
        }
        lock (_measurements)
        {
            _measurements.Add((instrument.Name, value, source));
        }
    }

    public void Dispose() => _listener.Dispose();
}
