# LogHarbor Query Language

Seq-like filter expressions typed into the search bar, saved as signals,
and used for live-tail subscriptions. Parsed by LogHarbor.Core QueryParser into SQL.

--- LITERALS ---

Strings:  'text' (single quotes; embedded quote doubled: 'O''Brien')
Numbers:  42, 3.14
Booleans: true, false
Null:     null

--- PROPERTY ACCESS ---

Bare identifier refers to a structured property:
  UserId, RequestPath, OrderId

Built-in fields (@ prefix):
  @Level, @Message, @Timestamp, @Exception, @MessageTemplate, @TraceId, @SpanId

@MessageTemplate is the raw CLEF @mt value ("Order {OrderId} failed"),
so one comparison matches every event of that error group regardless of
the property values rendered into the message.

@TraceId and @SpanId are the W3C trace/span ids (CLEF @tr/@sp, lowercase hex):
  @TraceId = '0af7651916cd43dd8448eb211c80319c' returns every event of one
  request, across services.

--- COMPARISONS ---

=   equals
<>  not equals
<   <=   >   >=  numeric/string comparison

Examples:
  UserId = 42
  @Level = 'Error'
  Elapsed > 500

--- TEXT OPERATORS ---

like        SQL LIKE with % wildcards:      RequestPath like '/api/%'
contains    substring:                      @Message contains 'timeout'
Free text:  a bare quoted string searches message + exception via FTS:
  'connection refused'

--- LOGICAL OPERATORS ---

and, or, not, parentheses

Examples:
  @Level = 'Error' and StatusCode >= 500
  (UserId = 42 or UserId = 43) and not RequestPath like '/health%'

--- EXISTENCE ---

Has(PropertyName)      property present
  Has(OrderId) and @Level = 'Warning'

--- GRAMMAR (EBNF) ---

expr        = or_expr
or_expr     = and_expr { "or" and_expr }
and_expr    = not_expr { "and" not_expr }
not_expr    = [ "not" ] primary
primary     = comparison | freetext | "(" expr ")" | has_call
comparison  = operand op operand
has_call    = "Has" "(" identifier ")"
operand     = property | builtin | literal
op          = "=" | "<>" | "<" | "<=" | ">" | ">=" | "like" | "contains"
freetext    = string_literal

--- SQL TRANSLATION EXAMPLES ---

@Level = 'Error'
  -> level = @p0

UserId = 42
  -> json_extract(properties, '$.UserId') = @p0

@Message contains 'timeout'
  -> message LIKE '%' || @p0 || '%' ESCAPE '\'
  (%, _ and \ in the user value are escaped; contains means literal substring)

'connection refused'
  -> id IN (SELECT rowid FROM events_fts WHERE events_fts MATCH @p0)
  (@p0 is always wrapped as a double-quoted FTS phrase, embedded quotes doubled;
  user text can never inject MATCH operators like AND/OR/NEAR)

@Exception <> null
  -> exception IS NOT NULL
  (null works with = and <> only; other operators are rejected)

--- ERRORS ---

Parser reports: error message + character position.
Unknown @ field, unbalanced parens, bad operator -> 400 from /api/query/validate.
