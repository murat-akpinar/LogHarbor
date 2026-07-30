#!/bin/bash
# Creates the LogHarbor test users and the two groups that decide their role.
# Run inside the container, AFTER enable-memberof.sh:
#
#   docker exec ldap-test bash /scripts/init.sh
#
# The user set is the matrix Phase 21 has to be verified against: a user in each
# group, a user in both (admin outranks viewer), and a user in neither — the last one
# is the case that has to be refused, and it is the one nobody remembers to create.

set -e

BASE="dc=test,dc=local"
ADMIN="cn=admin,$BASE"
PW="admin123"
LDAP="ldap://localhost"

ldap_add() { ldapadd -x -H "$LDAP" -D "$ADMIN" -w "$PW" >/dev/null 2>&1 || true; }
ldap_mod() { ldapmodify -x -H "$LDAP" -D "$ADMIN" -w "$PW" >/dev/null 2>&1 || true; }

echo "=== LogHarbor LDAP test directory ==="

if ! ldapsearch -x -H "$LDAP" -b "$BASE" -D "$ADMIN" -w "$PW" >/dev/null 2>&1; then
    echo "ERROR: cannot reach the directory at $LDAP" >&2
    exit 1
fi

if ! ldapsearch -Y EXTERNAL -H ldapi:/// -LLL -b cn=config "(olcOverlay=memberof)" dn 2>/dev/null | grep -q memberof; then
    echo "ERROR: the memberof overlay is not loaded — run enable-memberof.sh first," >&2
    echo "       otherwise the users get created with no memberOf and every login" >&2
    echo "       maps to no role." >&2
    exit 1
fi

echo "-- organizational units --"
ldap_add <<EOF
dn: ou=users,$BASE
objectClass: organizationalUnit
ou: users
EOF
ldap_add <<EOF
dn: ou=groups,$BASE
objectClass: organizationalUnit
ou: groups
EOF

# uid, password, uidNumber, cn, groups (comma separated, empty = in neither)
USERS=(
  "adminuser|adminpass123|10002|Admin User|logharbor-admin"
  "ldap_user1|ldappass123|10010|LDAP User One|logharbor-admin,logharbor-viewer"
  "testuser1|testpass123|10000|Test User One|logharbor-viewer"
  "testuser2|testpass123|10001|Test User Two|logharbor-viewer"
  "ldap_user2|ldappass123|10011|LDAP User Two|"
)

echo "-- users --"
for row in "${USERS[@]}"; do
    IFS='|' read -r uid pass uidnum cn groups <<< "$row"
    echo "   $uid"
    ldapdelete -x -H "$LDAP" -D "$ADMIN" -w "$PW" "uid=$uid,ou=users,$BASE" >/dev/null 2>&1 || true
    ldap_add <<EOF
dn: uid=$uid,ou=users,$BASE
objectClass: inetOrgPerson
objectClass: posixAccount
objectClass: shadowAccount
uid: $uid
sn: ${cn##* }
givenName: ${cn%% *}
cn: $cn
displayName: $cn
uidNumber: $uidnum
gidNumber: $uidnum
gecos: $cn
loginShell: /bin/bash
homeDirectory: /home/$uid
mail: $uid@test.local
EOF
    ldappasswd -x -H "$LDAP" -D "$ADMIN" -w "$PW" -s "$pass" "uid=$uid,ou=users,$BASE" >/dev/null 2>&1 || true
done

# groupOfNames refuses to exist without at least one member, so each group is created
# holding its first member and the rest are added after
echo "-- groups --"
for group in logharbor-admin logharbor-viewer; do
    members=()
    for row in "${USERS[@]}"; do
        IFS='|' read -r uid _ _ _ groups <<< "$row"
        case ",$groups," in *",$group,"*) members+=("$uid");; esac
    done
    echo "   $group: ${members[*]}"

    ldapdelete -x -H "$LDAP" -D "$ADMIN" -w "$PW" "cn=$group,ou=groups,$BASE" >/dev/null 2>&1 || true
    first="${members[0]}"
    ldap_add <<EOF
dn: cn=$group,ou=groups,$BASE
objectClass: groupOfNames
objectClass: top
cn: $group
description: LogHarbor ${group#logharbor-} role
member: uid=$first,ou=users,$BASE
EOF
    for uid in "${members[@]:1}"; do
        ldap_mod <<EOF
dn: cn=$group,ou=groups,$BASE
changetype: modify
add: member
member: uid=$uid,ou=users,$BASE
EOF
    done
done

echo ""
echo "=== done ==="
printf '%-12s %-14s %-34s %s\n' USER PASSWORD "MEMBEROF" "EXPECTED LOGHARBOR ROLE"
for row in "${USERS[@]}"; do
    IFS='|' read -r uid pass _ _ groups <<< "$row"
    case ",$groups," in
        *",logharbor-admin,"*) role="Admin";;
        *",logharbor-viewer,"*) role="Viewer";;
        *) role="refused (in neither group)";;
    esac
    printf '%-12s %-14s %-34s %s\n' "$uid" "$pass" "${groups:--}" "$role"
done
