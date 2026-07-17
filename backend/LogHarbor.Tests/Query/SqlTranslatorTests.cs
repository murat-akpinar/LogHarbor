using LogHarbor.Core.Query;

namespace LogHarbor.Tests.Query;

public sealed class SqlTranslatorTests
{
    private static QuerySql Translate(string filter) => SqlTranslator.Translate(QueryParser.Parse(filter));

    [Fact]
    public void BuiltinComparison_UsesColumnAndParameter()
    {
        var result = Translate("@Level = 'Error'");

        Assert.Equal("level = @q0", result.Sql);
        Assert.Equal(Pairs(Pair("@q0", "Error")), result.Parameters);
    }

    [Fact]
    public void PropertyComparison_UsesJsonExtract()
    {
        var result = Translate("UserId = 42");

        Assert.Equal("json_extract(properties, '$.\"UserId\"') = @q0", result.Sql);
        Assert.Equal(Pairs(Pair("@q0", 42L)), result.Parameters);
    }

    [Fact]
    public void DottedProperty_UsesQuotedJsonPathStep()
    {
        var result = Translate("service.name = 'checkout-api'");

        Assert.Equal("json_extract(properties, '$.\"service.name\"') = @q0", result.Sql);
        Assert.Equal(Pairs(Pair("@q0", "checkout-api")), result.Parameters);
    }

    [Fact]
    public void Contains_EscapesLikeWildcards()
    {
        var result = Translate("@Message contains '50%_do\\ne'");

        Assert.Equal("message LIKE '%' || @q0 || '%' ESCAPE '\\'", result.Sql);
        Assert.Equal(Pairs(Pair("@q0", "50\\%\\_do\\\\ne")), result.Parameters);
    }

    [Fact]
    public void Like_PassesPatternThroughUnescaped()
    {
        var result = Translate("RequestPath like '/api/%'");

        Assert.Equal("json_extract(properties, '$.\"RequestPath\"') LIKE @q0", result.Sql);
        Assert.Equal(Pairs(Pair("@q0", "/api/%")), result.Parameters);
    }

    [Fact]
    public void FreeText_BecomesQuotedFtsPhrase()
    {
        var result = Translate("'it''s \"here\"'");

        Assert.Equal("id IN (SELECT rowid FROM events_fts WHERE events_fts MATCH @q0)", result.Sql);
        Assert.Equal(Pairs(Pair("@q0", "\"it's \"\"here\"\"\"")), result.Parameters);
    }

    [Fact]
    public void SqlFor_RoutesFreeTextToTheGivenFtsTable()
    {
        var result = Translate("'refused' and UserId = 7");

        Assert.Equal(
            "(id IN (SELECT rowid FROM events_cache_fts WHERE events_cache_fts MATCH @q0) " +
            "AND json_extract(properties, '$.\"UserId\"') = @q1)",
            result.SqlFor("events_cache_fts"));
        // a property that happens to contain the hot table's name must never be rewritten
        Assert.Equal("json_type(properties, '$.\"events_fts\"') IS NOT NULL",
            Translate("Has(events_fts)").SqlFor("events_cache_fts"));
    }

    [Theory]
    [InlineData("@Exception = null", "exception IS NULL")]
    [InlineData("@Exception <> null", "exception IS NOT NULL")]
    [InlineData("null = OrderId", "json_extract(properties, '$.\"OrderId\"') IS NULL")]
    public void NullComparison_BecomesIsNull(string filter, string expectedSql)
    {
        var result = Translate(filter);

        Assert.Equal(expectedSql, result.Sql);
        Assert.Empty(result.Parameters);
    }

    [Theory]
    [InlineData("@TraceId = '0af7651916cd43dd8448eb211c80319c'", "trace_id = @q0", "0af7651916cd43dd8448eb211c80319c")]
    [InlineData("@SpanId = 'b7ad6b7169203331'", "span_id = @q0", "b7ad6b7169203331")]
    public void TraceBuiltins_MapToTraceColumns(string filter, string expectedSql, string expectedValue)
    {
        var result = Translate(filter);

        Assert.Equal(expectedSql, result.Sql);
        Assert.Equal(Pairs(Pair("@q0", expectedValue)), result.Parameters);
    }

    [Fact]
    public void Has_UsesJsonType()
    {
        Assert.Equal("json_type(properties, '$.\"OrderId\"') IS NOT NULL", Translate("Has(OrderId)").Sql);
    }

    [Fact]
    public void Has_WithDottedProperty_UsesQuotedJsonPathStep()
    {
        Assert.Equal("json_type(properties, '$.\"http.route\"') IS NOT NULL",
            Translate("Has(http.route)").Sql);
    }

    [Fact]
    public void BooleanLiteral_BecomesParameter()
    {
        var result = Translate("IsAdmin = true");

        Assert.Equal(Pairs(Pair("@q0", true)), result.Parameters);
    }

    [Fact]
    public void LogicalOperators_ParenthesizeAndNumberParameters()
    {
        var result = Translate("@Level = 'Error' and not (UserId = 1 or UserId = 2)");

        Assert.Equal(
            "(level = @q0 AND NOT ((json_extract(properties, '$.\"UserId\"') = @q1 OR json_extract(properties, '$.\"UserId\"') = @q2)))",
            result.Sql);
        Assert.Equal(
            Pairs(Pair("@q0", "Error"), Pair("@q1", 1L), Pair("@q2", 2L)),
            result.Parameters);
    }

    private static KeyValuePair<string, object>[] Pairs(params KeyValuePair<string, object>[] pairs) => pairs;

    private static KeyValuePair<string, object> Pair(string name, object value) => new(name, value);
}


