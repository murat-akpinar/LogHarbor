#!/bin/bash
# Turns on the memberOf overlay. Run once, inside the container, BEFORE the groups
# are created:
#
#   docker exec ldap-test bash /scripts/enable-memberof.sh
#
# Why this file exists at all: an out-of-the-box OpenLDAP does not maintain memberOf.
# Membership lives on the group (member: <user dn>) and the user entry says nothing
# about it, so reading a user's own entry — which is exactly how Phase 21 decides a
# role — comes back with no groups and every login maps to no role. Active Directory
# maintains memberOf for free, which is why a directory that behaves like AD has to be
# asked for it explicitly here.
#
# The overlay only fills in memberOf for memberships written after it is loaded, so
# ordering matters: this runs first, init.sh second.

set -e

CONFIG_LDIF=/tmp/memberof-config.ldif

# the mdb database is {1} on a default install, but read it rather than assume it
DB_DN=$(ldapsearch -Y EXTERNAL -H ldapi:/// -LLL -b cn=config "(olcSuffix=dc=test,dc=local)" dn 2>/dev/null \
        | awk '/^dn:/ {print $2}')
if [ -z "$DB_DN" ]; then
    echo "ERROR: could not find the database for dc=test,dc=local under cn=config" >&2
    exit 1
fi
echo "database: $DB_DN"

# osixia/openldap 1.5.0 ships the overlay already loaded, but wired to
# groupOfUniqueNames/uniqueMember. Active Directory puts membership in `member`, and so
# does init.sh — and an overlay watching the wrong attribute does not fail, it just
# never fills memberOf in, which reads exactly like "this user is in no groups".
# So: fix the existing overlay rather than declaring victory.
OVERLAY_DN=$(ldapsearch -Y EXTERNAL -H ldapi:/// -LLL -b cn=config "(olcOverlay=memberof)" dn 2>/dev/null \
             | awk '/^dn:/ {print $2}')
if [ -n "$OVERLAY_DN" ]; then
    echo "memberof overlay present: $OVERLAY_DN"
    cat > "$CONFIG_LDIF" <<EOF
dn: $OVERLAY_DN
changetype: modify
replace: olcMemberOfGroupOC
olcMemberOfGroupOC: groupOfNames
-
replace: olcMemberOfMemberAD
olcMemberOfMemberAD: member
-
replace: olcMemberOfMemberOfAD
olcMemberOfMemberOfAD: memberOf
-
replace: olcMemberOfDangling
olcMemberOfDangling: ignore
EOF
    ldapmodify -Y EXTERNAL -H ldapi:/// -f "$CONFIG_LDIF" 2>&1 | grep -v "^SASL" || true
    rm -f "$CONFIG_LDIF"
    echo "overlay repointed at groupOfNames/member"
    ldapsearch -Y EXTERNAL -H ldapi:/// -LLL -b cn=config "(olcOverlay=memberof)" \
        olcMemberOfGroupOC olcMemberOfMemberAD olcMemberOfMemberOfAD 2>/dev/null | grep -v '^$'
    exit 0
fi

cat > "$CONFIG_LDIF" <<EOF
dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: memberof

dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: refint

dn: olcOverlay=memberof,$DB_DN
changetype: add
objectClass: olcConfig
objectClass: olcMemberOf
objectClass: olcOverlayConfig
objectClass: top
olcOverlay: memberof
olcMemberOfRefInt: TRUE
olcMemberOfDangling: ignore
olcMemberOfGroupOC: groupOfNames
olcMemberOfMemberAD: member
olcMemberOfMemberOfAD: memberOf

dn: olcOverlay=refint,$DB_DN
changetype: add
objectClass: olcConfig
objectClass: olcOverlayConfig
objectClass: olcRefintConfig
objectClass: top
olcOverlay: refint
olcRefintAttribute: memberof member manager owner
EOF

# the module may already be loaded from a previous run; -c keeps going past that
ldapmodify -c -Y EXTERNAL -H ldapi:/// -f "$CONFIG_LDIF" 2>&1 | grep -v "^SASL" || true
rm -f "$CONFIG_LDIF"

if ldapsearch -Y EXTERNAL -H ldapi:/// -LLL -b cn=config "(olcOverlay=memberof)" dn 2>/dev/null | grep -q memberof; then
    echo "memberof overlay is loaded"
else
    echo "ERROR: memberof overlay did not load" >&2
    exit 1
fi
