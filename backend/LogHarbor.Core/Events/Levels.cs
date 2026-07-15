namespace LogHarbor.Core.Events;

/// <summary>The six canonical levels (docs/data-model.md), in severity order.</summary>
public static class Levels
{
    public static readonly IReadOnlyList<string> All =
        ["Verbose", "Debug", "Information", "Warning", "Error", "Fatal"];
}
