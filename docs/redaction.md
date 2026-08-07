# Redaction: the values this server refuses to keep

Whatever an application logs, LogHarbor stores verbatim and keeps: a password in a
property bag, an Authorization header a middleware captured, a national id in a
request body. Redaction is the one switch that stops that, and it is **off until
you name something** — the list ships empty.

Why off by default: dropping data at ingest is irreversible, and a server that
quietly deletes fields nobody asked it to delete loses information invisibly and
permanently. Seq does not redact by default either.

--- HOW IT WORKS ---

Settings -> Ingestion -> Redaction holds a list of property names. Every event
arriving on /api/events/raw (CLEF and the Seq envelope) and /v1/logs (OTLP) is
rewritten before it is written to the database, so nothing on disk ever held the
value.

Names are matched as **fragments, ignoring case**, against every property name in
the event including nested ones. "token" covers AccessToken, refresh_token and
X-Csrf-Token; that is what makes a short list worth keeping.

The value is **replaced, not deleted**:

    "Authorization": "[redacted]"

The key survives on purpose. "This request carried no Authorization header" and
"it did, and this server refused to keep it" are different facts, and a missing
key tells the first while meaning the second. The event detail draws the
placeholder in the warning colour and offers no filter action on that row — every
redacted row holds the same text, so filtering by it would select the redactions
rather than anything about the event.

--- THE MESSAGE, TOO ---

A rendered message is the properties spelled into a sentence. Redacting the bag
and leaving

    Signed in as ada with hunter2

on the row would hide the secret from the property tree and from nowhere else, so
the message is rewritten as well — but only when it actually holds a redacted
value:

  * the event has a message template (@mt, the normal case for Serilog, NLog and
    OTLP): the message is rendered again from the redacted properties, which is
    exactly what the sender would have produced.
  * the event arrived pre-rendered with no template (CLEF @m alone): the value is
    replaced as text.

A value shorter than 3 characters is not scrubbed out of a pre-rendered message.
Two characters cannot be told from ordinary text by substring search, and blanking
every "42" in a sentence damages the line to hide something the property already
shows as redacted. Templated events do not go through that path and are exact
either way.

--- WHAT IT DOES NOT REACH ---

Say this out loud when you turn it on, because a list that reads as "secrets
cannot be here" stops people looking at the places it cannot clean:

  * **Events already stored.** It applies to what arrives from now on. There is no
    retro-active pass, and there will not be one that pretends to be complete —
    archived days are compressed files, and a rewrite that missed them would be
    worse than no rewrite at all.
  * **Free text.** It reads property *names*. A secret pasted into a message
    string that never was a property, or sitting inside an exception stack trace,
    stays.
  * **Anything not on the list.** There is no built-in list. The card offers the
    usual names (password, authorization, cookie, token, secret, api_key,
    credential) as one-click suggestions, and each one is still a deliberate
    click.

--- API ---

    GET /api/settings/redaction    200: { "properties": ["password"], "enabled": true }
    PUT /api/settings/redaction    body { "properties": ["Password", " token "] }

PUT trims, lowercases and deduplicates before saving — the match is
case-insensitive, so two entries differing only in case are one rule wearing two
hats. At most 50 names, each at most 64 characters, no control characters
(400 with a ProblemDetails otherwise). Reading is open to any session; saving is a
mutation, so it needs the admin role like every other setting.

--- IF YOU NEED MORE THAN THIS ---

Redact at the source. A logging library that never puts the value in the event is
strictly better than a server that removes it on arrival: the value then never
crosses the network either. Serilog has destructuring policies, and OpenTelemetry
has processors. This exists for what those miss, and for the day nobody has time
to redeploy the application.
