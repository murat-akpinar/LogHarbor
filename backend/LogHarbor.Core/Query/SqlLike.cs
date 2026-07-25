namespace LogHarbor.Core.Query;

/// <summary>
/// LIKE-pattern escaping for values that must match literally. Every query built here pairs it
/// with ESCAPE '\'. Shared by the query translator's `contains` and the suggestion prefixes —
/// two copies of the same three Replace calls, and a value escaped by one rule and matched by
/// the other silently returns the wrong rows.
/// </summary>
public static class SqlLike
{
    public static string Escape(string value) =>
        value.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
}
