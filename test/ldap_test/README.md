# LDAP test directory

A directory to develop and verify **Phase 21 (AD / LDAP sign-in)** against, without
needing a real domain controller for every change.

Running at **192.168.1.132** (`/root/ldap_test`). LogHarbor itself runs on
192.168.1.131; all three ports below are reachable from there.

| | |
|---|---|
| Host | `192.168.1.132` |
| Plain / StartTLS | `ldap://192.168.1.132:389` |
| LDAPS | `ldaps://192.168.1.132:636` (self-signed) |
| Base DN | `dc=test,dc=local` |
| Bind DN pattern | `uid=<username>,ou=users,dc=test,dc=local` |
| Admin DN | `cn=admin,dc=test,dc=local` / `admin123` |
| phpLDAPadmin | http://192.168.1.132:8082 |

## Users, and the role each one should produce

The set is deliberately the matrix Phase 21 has to be checked against — including the
two cases that are easy to forget: someone in **both** groups, and someone in
**neither**.

| user | password | memberOf | expected role |
|---|---|---|---|
| `adminuser` | `adminpass123` | logharbor-admin | Admin |
| `ldap_user1` | `ldappass123` | logharbor-admin + logharbor-viewer | **Admin** (admin outranks viewer) |
| `testuser1` | `testpass123` | logharbor-viewer | Viewer |
| `testuser2` | `testpass123` | logharbor-viewer | Viewer |
| `ldap_user2` | `ldappass123` | finance-payroll only | **refused** — in groups, but not ours |

Groups live at `cn=logharbor-admin,ou=groups,dc=test,dc=local` and
`cn=logharbor-viewer,ou=groups,dc=test,dc=local`. `finance-payroll` exists so one user is in a
group LogHarbor knows nothing about — "in groups, but not ours" behaves differently from "in no
groups at all", and it is the case that caught a refused sign-in logging a person's whole group
list.

Note that `memberOf` comes back as a full DN
(`cn=logharbor-admin,ou=groups,dc=test,dc=local`), not a bare name — whatever maps
groups to roles has to compare the CN, not the whole string.

## What this directory can and cannot prove

It **can** prove: a bind with the user's own credentials, reading `memberOf` off the
user's own entry, the group → role mapping including admin-outranks-viewer, the
refusal of a user in neither group, a wrong password, LDAPS and StartTLS.

It **cannot** prove two AD-specific things, because OpenLDAP has neither:

* **UPN bind.** AD accepts `user@domain`; OpenLDAP binds by DN
  (`uid=adminuser,ou=users,dc=test,dc=local`). If the authenticator only ever builds
  `<username>@<upnSuffix>`, it cannot talk to this directory at all — the bind DN
  needs to be a pattern, or the implementation needs a DN-bind mode.
* **Nested groups.** The `member:1.2.840.113556.1.4.1941:=<dn>` matching rule is an AD
  extension; OpenLDAP does not implement it. `nestedGroups` still has to be checked
  against a real domain controller.

## Setup, from nothing

```bash
cd /root/ldap_test
docker compose up -d
docker exec ldap-test bash /scripts/enable-memberof.sh   # BEFORE the groups exist
docker exec ldap-test bash /scripts/init.sh
docker exec ldap-test bash /scripts/test-connection.sh 192.168.1.132
```

**The ordering is not optional.** An out-of-the-box OpenLDAP does not maintain
`memberOf` at all, and the overlay only fills it in for memberships written *after* it
is loaded. Create the groups first and every user reads back as belonging to nothing —
which looks exactly like a correct directory containing no memberships, and is the
failure this whole directory exists to catch early.

There is a second trap inside that one: `osixia/openldap:1.5.0` ships the overlay
already loaded but pointed at `groupOfUniqueNames`/`uniqueMember`, while AD (and
`init.sh`) use `member`. A mispointed overlay does not error — it silently never
populates `memberOf`. `enable-memberof.sh` repoints it, and refuses to let `init.sh`
run before it has.

## Re-running

`init.sh` deletes and recreates its users and groups, so it is safe to run again after
editing the user table at the top of it. To start from an empty directory:

```bash
docker compose down -v && docker compose up -d
```

## Checking by hand

```bash
# what LogHarbor will do: bind as the user, read that user's own entry
docker exec ldap-test ldapsearch -x -H ldap://localhost \
  -D "uid=testuser1,ou=users,dc=test,dc=local" -w testpass123 \
  -b "uid=testuser1,ou=users,dc=test,dc=local" -s base memberOf

# everything in the tree, as admin
docker exec ldap-test ldapsearch -x -H ldap://localhost \
  -D "cn=admin,dc=test,dc=local" -w admin123 -b "dc=test,dc=local"
```

## Files

| file | what it does |
|---|---|
| `docker-compose.yml` | OpenLDAP + phpLDAPadmin, TLS on, standalone (no external network) |
| `enable-memberof.sh` | loads/repoints the memberOf overlay — run first, once |
| `init.sh` | creates the OUs, users, groups and memberships |
| `test-connection.sh` | the verification above; exits non-zero on any failure |
