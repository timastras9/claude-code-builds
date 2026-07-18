#!/usr/bin/env bash
# End-to-end auth tests driven entirely through curl + a cookie jar.
set -uo pipefail

BASE="http://localhost:3001"
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
JAR="$TMP/cookies.txt"
ANON_JAR="$TMP/anon.txt"
DB="$TMP/test-auth.db"
PASS=0
FAIL=0

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null   # reap quietly so bash prints no "Terminated" notice
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
check(){ # check <description> <actual> <expected>
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi
}

# Start a server on a test port against a throwaway database.
echo "▶ starting test server on :3001"
cd "$DIR"
DB_PATH="$DB" PORT=3001 node server.js > "$TMP/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  curl -s -o /dev/null "$BASE/login" && break
  sleep 0.25
done
if ! curl -s -o /dev/null "$BASE/login"; then
  echo "server failed to start:"; cat "$TMP/server.log"; exit 1
fi

USER="alice_$$"

echo
echo "▶ 1. signup creates an account and logs the user in"
CODE=$(curl -s -o "$TMP/o" -w '%{http_code}' -c "$JAR" \
  -d "username=$USER" -d 'password=hunter2hunter2' "$BASE/signup")
check "signup redirects (302)" "$CODE" "302"
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' -c "$TMP/j2" \
  -d "username=${USER}b" -d 'password=hunter2hunter2' "$BASE/signup")
check "signup lands on /dashboard" "${LOC##*$BASE}" "/dashboard"
grep -q "$USER" <<< "$(curl -s -b "$JAR" "$BASE/dashboard")" \
  && ok "session cookie works right after signup" \
  || bad "session cookie works right after signup"

echo
echo "▶ 2. duplicate username is rejected"
OUT=$(curl -s -w '\n%{http_code}' -d "username=$USER" -d 'password=hunter2hunter2' "$BASE/signup")
check "duplicate returns 409" "$(tail -n1 <<< "$OUT")" "409"
grep -qi "already taken" <<< "$OUT" \
  && ok "duplicate shows inline error" || bad "duplicate shows inline error"

echo
echo "▶ 3. weak password is rejected"
OUT=$(curl -s -w '\n%{http_code}' -d "username=weak_$$" -d 'password=abc' "$BASE/signup")
check "weak password returns 400" "$(tail -n1 <<< "$OUT")" "400"
grep -qi "too weak" <<< "$OUT" \
  && ok "weak password shows inline error" || bad "weak password shows inline error"

echo
echo "▶ 4. /dashboard is blocked when logged out"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -c "$ANON_JAR" "$BASE/dashboard")
check "anonymous /dashboard returns 302" "$CODE" "302"
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/dashboard")
check "anonymous /dashboard redirects to /login" "${LOC##*$BASE}" "/login"

echo
echo "▶ 5. login with the demo user works"
rm -f "$JAR"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" \
  -d 'username=demo' -d 'password=demo1234' "$BASE/login")
check "demo login redirects (302)" "$CODE" "302"
BODY=$(curl -s -b "$JAR" "$BASE/dashboard")
grep -q 'Hi, demo' <<< "$BODY" && ok "/dashboard greets demo" || bad "/dashboard greets demo"
grep -qi 'Member since' <<< "$BODY" && ok "/dashboard shows signup date" || bad "/dashboard shows signup date"

echo
echo "▶ 6. wrong password is rejected"
OUT=$(curl -s -w '\n%{http_code}' -c "$TMP/bad.txt" \
  -d 'username=demo' -d 'password=wrongwrongwrong' "$BASE/login")
check "wrong password returns 401" "$(tail -n1 <<< "$OUT")" "401"
grep -qi "Incorrect username or password" <<< "$OUT" \
  && ok "wrong password shows inline error" || bad "wrong password shows inline error"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$TMP/bad.txt" "$BASE/dashboard")
check "failed login grants no session" "$CODE" "302"

echo
echo "▶ 7. passwords are bcrypt-hashed at rest, never plaintext"
HASH=$(DB_PATH="$DB" node -e "
  const db=require('better-sqlite3')(process.env.DB_PATH, {readonly:true});
  process.stdout.write(db.prepare('SELECT password_hash FROM users WHERE username=?').get('demo').password_hash);
")
[[ "$HASH" == '$2b$'* ]] && ok 'stored hash is bcrypt ($2b$ prefix)' || bad "stored hash is bcrypt (got '${HASH:0:10}')"
if [[ -n "$HASH" && "$HASH" != *'demo1234'* ]]; then
  ok "plaintext password not stored"
else
  bad "plaintext password not stored (hash was '${HASH:0:20}')"
fi

echo
echo "▶ 8. logout ends the session"
curl -s -o /dev/null -b "$JAR" -c "$JAR" "$BASE/logout"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/dashboard")
check "/dashboard blocked after logout" "$CODE" "302"

echo
echo "─────────────────────────────"
echo "  $PASS passed, $FAIL failed"
echo "─────────────────────────────"

if [[ $FAIL -eq 0 ]]; then
  {
    echo "All $PASS auth tests passed."
    echo "Verified: signup, duplicate user, weak password, login, wrong password,"
    echo "bcrypt hashing at rest, protected /dashboard, and logout."
  } > "$DIR/DONE.txt"
  echo "✅ wrote DONE.txt"
  exit 0
fi

echo "❌ tests failed — DONE.txt not written"
exit 1
