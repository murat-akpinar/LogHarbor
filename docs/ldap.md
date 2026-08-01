# Directory sign-in (LDAP / Active Directory)

A domain user signs in with their directory credentials. No account is created in LogHarbor
first, and their group membership decides whether they are an admin or a viewer.

Configured entirely on the **Settings** page — nothing goes in a config file, and no password
is stored anywhere. LogHarbor binds as the user who is signing in, which both proves who they
are and lets it read their own groups back.

## What to put in each field

| Field | Active Directory | OpenLDAP / other |
|---|---|---|
| Server | `dc01.corp.example` | `ldap.example.internal` |
| Port | 636 (LDAPS) or 389 (StartTLS) | same |
| Connection | LDAPS or StartTLS | same |
| Base DN | `dc=corp,dc=example` | `dc=example,dc=internal` |
| UPN suffix | `corp.example` | leave blank |
| User DN pattern | leave blank | `uid={0},ou=users,dc=example,dc=internal` |
| Admin group | `logharbor-admin` | same |
| Viewer group | `logharbor-viewer` | same |

**One of UPN suffix or user DN pattern is required.** They are two ways of turning a username
into something to bind as:

* **UPN suffix** is Active Directory's, and needs no knowledge of where the account sits in the
  tree: `jdoe` + `corp.example` binds as `jdoe@corp.example`.
* **User DN pattern** builds the full DN, with `{0}` replaced by the username. Everything that
  is not AD needs this, because UPN bind is an AD extension that no other directory implements.

If both are filled in, the DN pattern wins.

## The two groups

Create `logharbor-admin` and `logharbor-viewer` in the directory (any name works — the fields
are settings) and put people in them. Then:

* in the admin group → **admin**
* in the viewer group → **viewer**
* in both → **admin**, because the alternative is a role that depends on which one the
  directory happened to list first
* in neither → **refused**

Someone in neither group gets exactly what a wrong password gets: `401`, same body, nothing
else. The real reason goes to the server log — "no such user" and "in none of the LogHarbor
groups" are both answers an attacker would like:

```
warn: LogHarbor.Ldap[0]
      LDAP sign-in refused for jdoe: in none of the configured groups (1 membership(s) found)
warn: LogHarbor.Ldap[0]
      LDAP sign-in refused for jdoe: the directory rejected the credentials
```

That line is where to look when someone says they cannot sign in, and the two reasons above
are the two it distinguishes: the password was wrong, or the password was right and the
groups were not.

It counts the memberships rather than listing them. Which groups a person is in is their
data, and a server log is the wrong place to accumulate it — so when you need the names, use
the test button below, which reports them to the admin who pressed it and writes nothing.

## Press the test button

The card has a username and password box and a **Test** button. It asks the directory the same
question the login page will and shows what came back — the groups it returned and the role
they map to — without creating a session. It tests what is on screen, so it can be pressed
before saving.

Use it. Everything that can be wrong here — a base DN one level too deep, a group named
differently in this domain, a certificate nobody trusts — is invisible until somebody tries to
sign in, and then it is a 401 with no reason attached.

A likely first result is *"the password was accepted, but this account is in neither group"*
together with a list of the groups it did find. Compare those to what you typed in the group
fields; note that they come back as full DNs (`cn=logharbor-admin,ou=groups,dc=…`), and either
the bare name or the whole DN is accepted in the settings.

## Certificates

Plain `ldap://` puts a domain password on the wire, so the Connection field defaults to LDAPS
and the plain option carries a warning. Prefer StartTLS or LDAPS on any network you do not
already trust end to end.

**Accept an untrusted certificate** exists for self-signed test directories. It keeps the
connection encrypted but stops it proving who is on the other end, so it should not survive
into production.

It is the one setting on this card that needs a **server restart** on Linux, because of how it
has to be applied: .NET's LDAP client there is a thin layer over the system libldap, which does
its own TLS verification and ignores the managed "trust this certificate" callback entirely, so
LogHarbor sets libldap's `TLS_REQCERT` at startup instead — and libldap reads that exactly once
per process.

Do not expect to need it first. Measured 2026-08-01 against `test/ldap_test`'s self-signed
OpenLDAP, from the shipped image (Debian 12, .NET 8 runtime, libldap 2.5): both **LDAPS on 636
and StartTLS on 389 bound and read the user's groups with this setting off**, no restart
involved. The container carries no `/etc/ldap/ldap.conf`, so libldap is not being told to
demand a chain it cannot build.

Where it does bite, the failure does not say "certificate" anywhere:

```
LDAP error 81: The LDAP server is unavailable.
LDAP error 91: The connection cannot be established.
```

— on StartTLS and LDAPS while plain `ldap://` to the same host works fine. That combination is
a certificate rejection wearing the words "server unavailable", and this setting plus a restart
is the answer to it.

If you turn the setting on and press **Test** before restarting, and the directory was in fact
rejecting the certificate, that is exactly what you will still see — so the test button adds
"this server has not been restarted since …" to the message rather than leaving you looking
for a network fault.

The better answer for anything long-lived is to install the directory's CA certificate into the
container's trust store and leave this off.

## Nested groups

Off by default. When on, LogHarbor also asks the directory for groups reached *through* other
groups — "member of a team that is a member of logharbor-admin", which plain `memberOf` does
not report.

This is **Active Directory only**: it uses the `member:1.2.840.113556.1.4.1941:` matching rule,
which no other directory implements. Elsewhere the extra query simply finds nothing, and the
direct memberships still work.

## What turning it on changes

Enabling directory sign-in **turns authentication on for the whole server**, even with no local
accounts. An LDAP-only install legitimately has no rows in the users table, and "is auth on?"
would otherwise answer "no users exist, so no" — leaving every page open to anyone who could
reach the port, on a server that looked configured.

Local accounts keep working alongside it; the login page offers both and remembers which one
was used last. The Users page lists local accounts only, and says so — a directory user has no
row there, because there is no password to keep and the role has to be re-read from the
directory on every login anyway. A mirrored copy would go stale the moment somebody is moved
out of a group.

## A directory to try it against

`test/ldap_test/` runs an OpenLDAP with the two groups and a user for each case — one in each
group, one in both, one in neither. Its README has the setup, including the two ways an
OpenLDAP silently reports no group memberships at all.
