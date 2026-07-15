namespace LogHarbor.Core.Query;

public abstract record QueryNode;

public sealed record AndNode(QueryNode Left, QueryNode Right) : QueryNode;

public sealed record OrNode(QueryNode Left, QueryNode Right) : QueryNode;

public sealed record NotNode(QueryNode Inner) : QueryNode;

public sealed record ComparisonNode(OperandNode Left, string Op, OperandNode Right) : QueryNode;

public sealed record HasNode(string Property) : QueryNode;

public sealed record FreeTextNode(string Text) : QueryNode;

public abstract record OperandNode;

public sealed record PropertyOperand(string Name) : OperandNode;

/// <summary>A validated @ field; Column is the events table column it maps to.</summary>
public sealed record BuiltinOperand(string Column) : OperandNode;

/// <summary>Value is string, long, double, bool, or null.</summary>
public sealed record LiteralOperand(object? Value) : OperandNode;

/// <summary>Recursive descent parser for the grammar in docs/query-language.md.</summary>
public sealed class QueryParser
{
    private static readonly Dictionary<string, string> BuiltinColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Level"] = "level",
        ["Message"] = "message",
        ["Timestamp"] = "timestamp",
        ["Exception"] = "exception",
        ["MessageTemplate"] = "message_template",
    };

    private readonly List<Token> _tokens;
    private int _index;

    private QueryParser(List<Token> tokens) => _tokens = tokens;

    private Token Current => _tokens[_index];

    public static QueryNode Parse(string filter)
    {
        var parser = new QueryParser(QueryTokenizer.Tokenize(filter));
        var node = parser.ParseOr();
        if (parser.Current.Type != TokenType.End)
        {
            throw new QueryParseException($"unexpected '{parser.Current.Text}'", parser.Current.Position);
        }
        return node;
    }

    private QueryNode ParseOr()
    {
        var left = ParseAnd();
        while (IsKeyword("or"))
        {
            _index++;
            left = new OrNode(left, ParseAnd());
        }
        return left;
    }

    private QueryNode ParseAnd()
    {
        var left = ParseNot();
        while (IsKeyword("and"))
        {
            _index++;
            left = new AndNode(left, ParseNot());
        }
        return left;
    }

    private QueryNode ParseNot()
    {
        if (IsKeyword("not"))
        {
            _index++;
            return new NotNode(ParsePrimary());
        }
        return ParsePrimary();
    }

    private QueryNode ParsePrimary()
    {
        if (Current.Type == TokenType.LParen)
        {
            _index++;
            var inner = ParseOr();
            if (Current.Type != TokenType.RParen)
            {
                throw new QueryParseException("expected ')'", Current.Position);
            }
            _index++;
            return inner;
        }
        if (IsKeyword("has") && _tokens[_index + 1].Type == TokenType.LParen)
        {
            return ParseHas();
        }
        // a lone string is free text; a string followed by an operator starts a comparison
        if (Current.Type == TokenType.String && !IsComparisonOp(_tokens[_index + 1]))
        {
            var text = Current.Text;
            if (text.Length == 0)
            {
                throw new QueryParseException("free-text term cannot be empty", Current.Position);
            }
            _index++;
            return new FreeTextNode(text);
        }
        return ParseComparison();
    }

    private QueryNode ParseHas()
    {
        _index += 2;
        if (Current.Type != TokenType.Identifier)
        {
            throw new QueryParseException("expected a property name inside Has()", Current.Position);
        }
        var property = Current.Text;
        _index++;
        if (Current.Type != TokenType.RParen)
        {
            throw new QueryParseException("expected ')'", Current.Position);
        }
        _index++;
        return new HasNode(property);
    }

    private QueryNode ParseComparison()
    {
        var left = ParseOperand();

        var opToken = Current;
        if (!IsComparisonOp(opToken))
        {
            throw new QueryParseException($"expected a comparison operator, got '{opToken.Text}'", opToken.Position);
        }
        var op = opToken.Text.ToLowerInvariant();
        _index++;

        var rightToken = Current;
        var right = ParseOperand();

        if (op is "like" or "contains" && right is not LiteralOperand { Value: string })
        {
            throw new QueryParseException($"right side of '{op}' must be a string", rightToken.Position);
        }
        if ((left is LiteralOperand { Value: null } || right is LiteralOperand { Value: null }) && op is not ("=" or "<>"))
        {
            throw new QueryParseException("null only supports = and <>", opToken.Position);
        }
        return new ComparisonNode(left, op, right);
    }

    private OperandNode ParseOperand()
    {
        var token = Current;
        switch (token.Type)
        {
            case TokenType.String:
                _index++;
                return new LiteralOperand(token.Text);
            case TokenType.Number:
                _index++;
                if (long.TryParse(token.Text, out var longValue))
                {
                    return new LiteralOperand(longValue);
                }
                if (double.TryParse(token.Text, System.Globalization.CultureInfo.InvariantCulture, out var doubleValue))
                {
                    return new LiteralOperand(doubleValue);
                }
                throw new QueryParseException($"invalid number '{token.Text}'", token.Position);
            case TokenType.Builtin:
                _index++;
                if (!BuiltinColumns.TryGetValue(token.Text, out var column))
                {
                    throw new QueryParseException($"unknown built-in field '@{token.Text}'", token.Position);
                }
                return new BuiltinOperand(column);
            case TokenType.Identifier when token.Text.Equals("true", StringComparison.OrdinalIgnoreCase):
                _index++;
                return new LiteralOperand(true);
            case TokenType.Identifier when token.Text.Equals("false", StringComparison.OrdinalIgnoreCase):
                _index++;
                return new LiteralOperand(false);
            case TokenType.Identifier when token.Text.Equals("null", StringComparison.OrdinalIgnoreCase):
                _index++;
                return new LiteralOperand(null);
            case TokenType.Identifier when !IsAnyKeyword(token.Text):
                _index++;
                return new PropertyOperand(token.Text);
            default:
                throw new QueryParseException(
                    $"expected a property, field, or value{(token.Type == TokenType.End ? "" : $", got '{token.Text}'")}",
                    token.Position);
        }
    }

    private bool IsKeyword(string keyword) =>
        Current.Type == TokenType.Identifier && Current.Text.Equals(keyword, StringComparison.OrdinalIgnoreCase);

    private static bool IsAnyKeyword(string text) =>
        text.ToLowerInvariant() is "and" or "or" or "not" or "like" or "contains";

    private static bool IsComparisonOp(Token token) =>
        token.Type == TokenType.Op
        || (token.Type == TokenType.Identifier
            && token.Text.ToLowerInvariant() is "like" or "contains");
}
