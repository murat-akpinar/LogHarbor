namespace LogHarbor.Core.Query;

/// <summary>
/// A parameterized SQL boolean expression over the events table. Free-text conditions carry
/// an FTS table placeholder so the same filter can run against the hot index (events_fts)
/// or the hydrated-cache index (events_cache_fts).
/// </summary>
public sealed record QuerySql(string SqlTemplate, IReadOnlyList<KeyValuePair<string, object>> Parameters)
{
    // never produced by the tokenizer (identifiers are [A-Za-z0-9_]) and all user values are
    // parameters, so this token can only come from the translator itself
    internal const string FtsTableToken = "{fts}";

    /// <summary>The expression against the hot events table.</summary>
    public string Sql => SqlFor("events_fts");

    /// <summary>The same expression with free-text matches routed to the given FTS table.</summary>
    public string SqlFor(string ftsTable) => SqlTemplate.Replace(FtsTableToken, ftsTable);
}

/// <summary>Translates a parsed filter to SQL. All user values become parameters (@q0, @q1, ...).</summary>
public sealed class SqlTranslator
{
    private readonly List<KeyValuePair<string, object>> _parameters = [];

    private SqlTranslator()
    {
    }

    public static QuerySql Translate(QueryNode node)
    {
        var translator = new SqlTranslator();
        var sql = translator.Visit(node);
        return new QuerySql(sql, translator._parameters);
    }

    private string Visit(QueryNode node) => node switch
    {
        AndNode n => $"({Visit(n.Left)} AND {Visit(n.Right)})",
        OrNode n => $"({Visit(n.Left)} OR {Visit(n.Right)})",
        NotNode n => $"NOT ({Visit(n.Inner)})",
        // json_type is NULL only when the path is absent, so a property holding JSON null still counts as present
        HasNode n => $"json_type(properties, '$.\"{n.Property}\"') IS NOT NULL",
        FreeTextNode n =>
            $"id IN (SELECT rowid FROM {QuerySql.FtsTableToken} WHERE {QuerySql.FtsTableToken} MATCH {AddParameter(FtsPhrase(n.Text))})",
        ComparisonNode n => VisitComparison(n),
        _ => throw new InvalidOperationException($"unhandled node {node.GetType().Name}"),
    };

    private string VisitComparison(ComparisonNode node)
    {
        if (node.Right is LiteralOperand { Value: null })
        {
            return $"{Operand(node.Left)} IS {(node.Op == "<>" ? "NOT " : "")}NULL";
        }
        if (node.Left is LiteralOperand { Value: null })
        {
            return $"{Operand(node.Right)} IS {(node.Op == "<>" ? "NOT " : "")}NULL";
        }
        if (node.Op == "contains")
        {
            var value = (string)((LiteralOperand)node.Right).Value!;
            return $"{Operand(node.Left)} LIKE '%' || {AddParameter(EscapeLike(value))} || '%' ESCAPE '\\'";
        }
        if (node.Op == "like")
        {
            return $"{Operand(node.Left)} LIKE {Operand(node.Right)}";
        }
        return $"{Operand(node.Left)} {node.Op} {Operand(node.Right)}";
    }

    private string Operand(OperandNode operand) => operand switch
    {
        BuiltinOperand b => b.Column,
        // safe to embed: the tokenizer restricts identifiers to [A-Za-z0-9_.]; the quoted
        // path step makes a dot part of the key, never a nesting separator
        PropertyOperand p => $"json_extract(properties, '$.\"{p.Name}\"')",
        LiteralOperand l => AddParameter(l.Value!),
        _ => throw new InvalidOperationException($"unhandled operand {operand.GetType().Name}"),
    };

    private string AddParameter(object value)
    {
        var name = $"@q{_parameters.Count}";
        _parameters.Add(new KeyValuePair<string, object>(name, value));
        return name;
    }

    /// <summary>contains means literal substring: escape LIKE wildcards in the user value.</summary>
    private static string EscapeLike(string value) =>
        value.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    /// <summary>Wraps free text as an FTS5 phrase so it can never inject MATCH operators.</summary>
    private static string FtsPhrase(string text) =>
        "\"" + text.Replace("\"", "\"\"") + "\"";
}
