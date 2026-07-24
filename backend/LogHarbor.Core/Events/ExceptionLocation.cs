using System.Text.RegularExpressions;

namespace LogHarbor.Core.Events;

/// <summary>
/// Extracts a "path:line" source location from an exception text, Nightwatch-style
/// ("resources/views/search/index.blade.php:38"). Stack-trace formats differ per
/// runtime, so the first matching pattern wins; null when no frame carries a file.
/// </summary>
public static partial class ExceptionLocation
{
    // .NET: "at Ns.Type.Method() in C:\src\File.cs:line 42"
    [GeneratedRegex(@" in (.+?):line (\d+)", RegexOptions.CultureInvariant)]
    private static partial Regex DotNet();

    // Python: File "/app/x.py", line 12
    [GeneratedRegex(@"File ""(.+?)"", line (\d+)", RegexOptions.CultureInvariant)]
    private static partial Regex Python();

    // Node: "at fn (/app/src/x.js:10:15)" — drop the column
    [GeneratedRegex(@"\((.+?):(\d+):\d+\)", RegexOptions.CultureInvariant)]
    private static partial Regex Node();

    // PHP and generic "path/file.ext:38" or "file.php(38)"; extension keeps it from
    // matching timestamps or URLs with ports
    [GeneratedRegex(@"(\S+\.\w{1,10})(?::(\d+)|\((\d+)\))", RegexOptions.CultureInvariant)]
    private static partial Regex Generic();

    public static string? FromText(string exception)
    {
        var dotNet = DotNet().Match(exception);
        if (dotNet.Success) return $"{dotNet.Groups[1].Value}:{dotNet.Groups[2].Value}";

        var python = Python().Match(exception);
        if (python.Success) return $"{python.Groups[1].Value}:{python.Groups[2].Value}";

        var node = Node().Match(exception);
        if (node.Success) return $"{node.Groups[1].Value}:{node.Groups[2].Value}";

        var generic = Generic().Match(exception);
        if (generic.Success)
        {
            var line = generic.Groups[2].Success ? generic.Groups[2].Value : generic.Groups[3].Value;
            return $"{generic.Groups[1].Value}:{line}";
        }
        return null;
    }
}
