namespace LogHarbor.Core.Events;

/// <summary>The six canonical levels (docs/data-model.md), in severity order.</summary>
public static class Levels
{
    public static readonly IReadOnlyList<string> All =
        ["Verbose", "Debug", "Information", "Warning", "Error", "Fatal"];

    /// <summary>Maps ingestion level aliases (CLEF @l, OTLP severity_text) to the canonical six.
    /// Unknown or missing values become Information (docs/data-model.md).</summary>
    public static string FromAlias(string? level) => level?.Trim().ToLowerInvariant() switch
    {
        "verbose" or "trace" => "Verbose",
        "debug" => "Debug",
        "warning" or "warn" => "Warning",
        "error" or "err" => "Error",
        "fatal" or "critical" or "crit" => "Fatal",
        _ => "Information",
    };
}
