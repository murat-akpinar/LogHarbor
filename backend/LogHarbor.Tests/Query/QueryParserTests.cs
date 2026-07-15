using LogHarbor.Core.Query;

namespace LogHarbor.Tests.Query;

public sealed class QueryParserTests
{
    [Theory]
    [InlineData("=")]
    [InlineData("<>")]
    [InlineData("<")]
    [InlineData("<=")]
    [InlineData(">")]
    [InlineData(">=")]
    public void Parses_AllComparisonOperators(string op)
    {
        var node = QueryParser.Parse($"Elapsed {op} 500");

        Assert.Equal(new ComparisonNode(new PropertyOperand("Elapsed"), op, new LiteralOperand(500L)), node);
    }

    [Fact]
    public void Parses_BuiltinField_ToColumn()
    {
        var node = QueryParser.Parse("@Level = 'Error'");

        Assert.Equal(new ComparisonNode(new BuiltinOperand("level"), "=", new LiteralOperand("Error")), node);
    }

    [Theory]
    [InlineData("@Message", "message")]
    [InlineData("@Timestamp", "timestamp")]
    [InlineData("@Exception", "exception")]
    [InlineData("@MessageTemplate", "message_template")]
    [InlineData("@level", "level")]
    public void Parses_AllBuiltinFields(string field, string column)
    {
        var node = QueryParser.Parse($"{field} = 'x'");

        Assert.Equal(new BuiltinOperand(column), ((ComparisonNode)node).Left);
    }

    [Theory]
    [InlineData("42", 42L)]
    [InlineData("3.14", 3.14)]
    [InlineData("true", true)]
    [InlineData("false", false)]
    [InlineData("null", null)]
    public void Parses_Literals(string literal, object? expected)
    {
        var node = QueryParser.Parse($"X = {literal}");

        Assert.Equal(new LiteralOperand(expected), ((ComparisonNode)node).Right);
    }

    [Fact]
    public void Parses_EscapedQuoteInString()
    {
        var node = QueryParser.Parse("Name = 'O''Brien'");

        Assert.Equal(new LiteralOperand("O'Brien"), ((ComparisonNode)node).Right);
    }

    [Fact]
    public void Parses_LikeAndContains_CaseInsensitively()
    {
        Assert.Equal(
            new ComparisonNode(new PropertyOperand("RequestPath"), "like", new LiteralOperand("/api/%")),
            QueryParser.Parse("RequestPath LIKE '/api/%'"));
        Assert.Equal(
            new ComparisonNode(new BuiltinOperand("message"), "contains", new LiteralOperand("timeout")),
            QueryParser.Parse("@Message Contains 'timeout'"));
    }

    [Fact]
    public void Parses_FreeText()
    {
        Assert.Equal(new FreeTextNode("connection refused"), QueryParser.Parse("'connection refused'"));
    }

    [Fact]
    public void Parses_StringFollowedByOperator_AsComparisonNotFreeText()
    {
        var node = QueryParser.Parse("'Error' = @Level");

        Assert.Equal(new ComparisonNode(new LiteralOperand("Error"), "=", new BuiltinOperand("level")), node);
    }

    [Fact]
    public void Parses_Has()
    {
        Assert.Equal(new HasNode("OrderId"), QueryParser.Parse("Has(OrderId)"));
    }

    [Fact]
    public void AndBindsTighterThanOr()
    {
        var node = QueryParser.Parse("A = 1 or B = 2 and C = 3");

        var or = Assert.IsType<OrNode>(node);
        Assert.IsType<ComparisonNode>(or.Left);
        Assert.IsType<AndNode>(or.Right);
    }

    [Fact]
    public void ParensOverridePrecedence()
    {
        var node = QueryParser.Parse("(A = 1 or B = 2) and C = 3");

        var and = Assert.IsType<AndNode>(node);
        Assert.IsType<OrNode>(and.Left);
    }

    [Fact]
    public void NotAppliesToPrimary()
    {
        var node = QueryParser.Parse("not RequestPath like '/health%' and A = 1");

        var and = Assert.IsType<AndNode>(node);
        Assert.IsType<NotNode>(and.Left);
    }

    [Theory]
    [InlineData("@Foo = 1", 0, "unknown built-in field '@Foo'")]
    [InlineData("(A = 1", 6, "expected ')'")]
    [InlineData("A ~ 1", 2, "unexpected character '~'")]
    [InlineData("A = 1 B = 2", 6, "unexpected 'B'")]
    [InlineData("'unterminated", 0, "unterminated string")]
    [InlineData("A like 5", 7, "right side of 'like' must be a string")]
    [InlineData("A contains 5", 11, "right side of 'contains' must be a string")]
    [InlineData("A < null", 2, "null only supports = and <>")]
    [InlineData("A = and", 4, "expected a property, field, or value, got 'and'")]
    [InlineData("A =", 3, "expected a property, field, or value")]
    [InlineData("Has(42)", 4, "expected a property name inside Has()")]
    [InlineData("''", 0, "free-text term cannot be empty")]
    [InlineData("A = 1.2.3", 4, "invalid number '1.2.3'")]
    [InlineData("@ = 1", 0, "expected a field name after '@'")]
    public void Rejects_InvalidFilters_WithPosition(string filter, int position, string message)
    {
        var ex = Assert.Throws<QueryParseException>(() => QueryParser.Parse(filter));

        Assert.Equal(message, ex.Message);
        Assert.Equal(position, ex.Position);
    }

    [Fact]
    public void Rejects_LoneProperty()
    {
        var ex = Assert.Throws<QueryParseException>(() => QueryParser.Parse("UserId"));

        Assert.StartsWith("expected a comparison operator", ex.Message);
    }
}
