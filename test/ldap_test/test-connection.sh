#!/bin/bash
# Proves the directory answers the three questions Phase 21 will ask it, from outside
# the container:
#
#   ./test-connection.sh [host]        (default 192.168.1.132)
#
# Needs ldapsearch on the machine running it; if there is none, run it on the LDAP
# host itself with `docker exec ldap-test bash /scripts/test-connection.sh localhost`.

HOST="${1:-192.168.1.132}"
BASE="dc=test,dc=local"
FAIL=0

check() {
    local label="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        printf '  ok    %-46s %s\n' "$label" "$actual"
    else
        printf '  FAIL  %-46s got "%s", expected "%s"\n' "$label" "$actual" "$expected"
        FAIL=1
    fi
}

# the role LogHarbor should derive: admin outranks viewer, everything else is a refusal
role_of() {
    case "$1" in
        *logharbor-admin*) echo "Admin";;
        *logharbor-viewer*) echo "Viewer";;
        *) echo "refused";;
    esac
}

echo "=== 1. reachability (ldap://$HOST:389) ==="
if ldapsearch -x -H "ldap://$HOST:389" -D "cn=admin,$BASE" -w admin123 -b "$BASE" -s base >/dev/null 2>&1; then
    echo "  ok    the directory answers"
else
    echo "  FAIL  no answer on ldap://$HOST:389"
    exit 1
fi

echo ""
echo "=== 2. each user binds with its own password and reads its own memberOf ==="
echo "    (exactly what Phase 21 does: bind as the user, then read that user's entry)"
while IFS='|' read -r uid pass expected; do
    [ -z "$uid" ] && continue
    dn="uid=$uid,ou=users,$BASE"
    memberof=$(ldapsearch -x -H "ldap://$HOST:389" -D "$dn" -w "$pass" -b "$dn" -s base memberOf -LLL 2>/dev/null \
               | sed -n 's/^memberOf: //p' | sed 's/,ou=groups.*//; s/^cn=//' | sort | tr '\n' ',' | sed 's/,$//')
    if [ -z "$memberof" ]; then
        if ldapsearch -x -H "ldap://$HOST:389" -D "$dn" -w "$pass" -b "$dn" -s base dn -LLL >/dev/null 2>&1; then
            memberof="(none)"
        else
            memberof="(bind failed)"
        fi
    fi
    check "$uid" "$expected" "$(role_of "$memberof")"
    printf '        memberOf: %s\n' "$memberof"
done <<'EOF'
adminuser|adminpass123|Admin
ldap_user1|ldappass123|Admin
testuser1|testpass123|Viewer
testuser2|testpass123|Viewer
ldap_user2|ldappass123|refused
EOF

echo ""
echo "=== 3. a wrong password is refused ==="
if ldapsearch -x -H "ldap://$HOST:389" -D "uid=adminuser,ou=users,$BASE" -w "definitely-wrong" \
     -b "$BASE" -s base >/dev/null 2>&1; then
    echo "  FAIL  a wrong password was accepted"
    FAIL=1
else
    echo "  ok    invalid credentials rejected"
fi

echo ""
echo "=== 4. TLS ==="
if LDAPTLS_REQCERT=never ldapsearch -x -H "ldaps://$HOST:636" -D "cn=admin,$BASE" -w admin123 -b "$BASE" -s base >/dev/null 2>&1; then
    echo "  ok    ldaps://$HOST:636 answers (self-signed: clients must trust it or skip verification)"
else
    echo "  FAIL  ldaps://$HOST:636 does not answer"
    FAIL=1
fi
if LDAPTLS_REQCERT=never ldapsearch -x -ZZ -H "ldap://$HOST:389" -D "cn=admin,$BASE" -w admin123 -b "$BASE" -s base >/dev/null 2>&1; then
    echo "  ok    StartTLS on 389 works"
else
    echo "  FAIL  StartTLS on 389 does not work"
    FAIL=1
fi

echo ""
if [ "$FAIL" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "SOME CHECKS FAILED"; fi
exit $FAIL
