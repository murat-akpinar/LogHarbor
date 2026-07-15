using System.Text;

namespace LogHarbor.Core.Query;

/// <summary>Filter could not be parsed; Position is the zero-based character offset.</summary>
public sealed class QueryParseException(string message, int position) : Exception(message)
{
    public int Position { get; } = position;
}

public enum TokenType { Identifier, Builtin, String, Number, LParen, RParen, Op, End }

public readonly record struct Token(TokenType Type, string Text, int Position);

public static class QueryTokenizer
{
    public static List<Token> Tokenize(string input)
    {
        var tokens = new List<Token>();
        var i = 0;
        while (i < input.Length)
        {
            var c = input[i];
            var start = i;
            if (char.IsWhiteSpace(c))
            {
                i++;
            }
            else if (c == '(')
            {
                tokens.Add(new Token(TokenType.LParen, "(", start));
                i++;
            }
            else if (c == ')')
            {
                tokens.Add(new Token(TokenType.RParen, ")", start));
                i++;
            }
            else if (c == '=')
            {
                tokens.Add(new Token(TokenType.Op, "=", start));
                i++;
            }
            else if (c is '<' or '>')
            {
                i++;
                var text = c.ToString();
                if (i < input.Length && (input[i] == '=' || (c == '<' && input[i] == '>')))
                {
                    text += input[i];
                    i++;
                }
                tokens.Add(new Token(TokenType.Op, text, start));
            }
            else if (c == '\'')
            {
                tokens.Add(new Token(TokenType.String, ScanString(input, ref i), start));
            }
            else if (c == '@')
            {
                i++;
                var name = ScanIdentifier(input, ref i);
                if (name.Length == 0)
                {
                    throw new QueryParseException("expected a field name after '@'", start);
                }
                tokens.Add(new Token(TokenType.Builtin, name, start));
            }
            else if (char.IsAsciiLetter(c) || c == '_')
            {
                tokens.Add(new Token(TokenType.Identifier, ScanIdentifier(input, ref i), start));
            }
            else if (char.IsAsciiDigit(c))
            {
                while (i < input.Length && (char.IsAsciiDigit(input[i]) || input[i] == '.'))
                {
                    i++;
                }
                tokens.Add(new Token(TokenType.Number, input[start..i], start));
            }
            else
            {
                throw new QueryParseException($"unexpected character '{c}'", start);
            }
        }
        tokens.Add(new Token(TokenType.End, "", input.Length));
        return tokens;
    }

    private static string ScanString(string input, ref int i)
    {
        var start = i;
        i++;
        var value = new StringBuilder();
        while (true)
        {
            if (i >= input.Length)
            {
                throw new QueryParseException("unterminated string", start);
            }
            if (input[i] == '\'')
            {
                // '' inside a string is an escaped single quote
                if (i + 1 < input.Length && input[i + 1] == '\'')
                {
                    value.Append('\'');
                    i += 2;
                    continue;
                }
                i++;
                return value.ToString();
            }
            value.Append(input[i]);
            i++;
        }
    }

    private static string ScanIdentifier(string input, ref int i)
    {
        var start = i;
        while (i < input.Length && (char.IsAsciiLetterOrDigit(input[i]) || input[i] == '_'))
        {
            i++;
        }
        return input[start..i];
    }
}
