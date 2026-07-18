#!/usr/bin/env bash
# End-to-end tests for Shortly: shorten -> redirect -> click counting.
# Runs against a throwaway database on a spare port so it never touches dev data.
set -uo pipefail

PORT=3999
BASE="http://localhost:$PORT"
DB_FILE="$(mktemp -u /tmp/shortly-test-XXXXXX.db)"

PASS=0
FAIL=0

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; printf '       %s\n' "$2"; FAIL=$((FAIL + 1)); }

check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected '$2', got '$3'"; fi
}

contains() { # contains <name> <needle> <haystack>
  case "$3" in
    *"$2"*) pass "$1" ;;
    *) fail "$1" "expected output to contain '$2'" ;;
  esac
}

cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null   # absorb the job-control "Terminated" notice
  fi
  rm -f "$DB_FILE" "$DB_FILE-wal" "$DB_FILE-shm"
}
trap cleanup EXIT

echo "Starting test server on port $PORT..."
DB_PATH="$DB_FILE" PORT="$PORT" node server.js >/tmp/shortly-test.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  curl -sf "$BASE/" -o /dev/null && break
  sleep 0.25
done

if ! curl -sf "$BASE/" -o /dev/null; then
  echo "Server failed to start. Log:"; cat /tmp/shortly-test.log; exit 1
fi
echo "Server up."
echo

echo "1. Homepage and seed data"
HOME_HTML=$(curl -s "$BASE/")
contains "homepage renders the form" 'name="url"' "$HOME_HTML"
contains "dashboard renders" "Dashboard" "$HOME_HTML"
contains "seed link present" "github.com/anthropics/claude-code" "$HOME_HTML"
contains "seed click count present" "1284" "$HOME_HTML"
SEED_ROWS=$(printf '%s' "$HOME_HTML" | grep -c 'class="code"')
check "4 seeded links" "4" "$SEED_ROWS"
echo

echo "2. POST /api/shorten"
SHORTEN=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/shorten" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/some/really/long/path?a=1&b=2"}')
STATUS=$(printf '%s' "$SHORTEN" | tail -n1)
BODY=$(printf '%s' "$SHORTEN" | sed '$d')
check "returns 201" "201" "$STATUS"

CODE=$(printf '%s' "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).code||"")}catch{process.stdout.write("")}})')
check "code is 6 characters" "6" "${#CODE}"
contains "response includes shortUrl" "\"shortUrl\"" "$BODY"
contains "response echoes the URL" "example.com" "$BODY"
echo

echo "3. URL validation"
for BAD in '"not a url"' '"javascript:alert(1)"' '""'; do
  BAD_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/shorten" \
    -H 'Content-Type: application/json' -d "{\"url\":$BAD}")
  check "rejects $BAD with 400" "400" "$BAD_STATUS"
done
echo

echo "4. GET /:code redirects (302)"
REDIRECT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$CODE")
check "returns 302" "302" "$REDIRECT_STATUS"
LOCATION=$(curl -s -o /dev/null -D - "$BASE/$CODE" | grep -i '^location:' | tr -d '\r' | awk '{print $2}')
check "Location is the original URL" "https://example.com/some/really/long/path?a=1&b=2" "$LOCATION"
echo

echo "5. Click counting"
# One click landed above from the status check, one from the Location check.
for _ in 1 2 3; do curl -s -o /dev/null "$BASE/$CODE"; done
# 2 (above) + 3 = 5
CLICKS=$(curl -s "$BASE/" | grep -A2 ">/$CODE<" | grep 'class="clicks"' | sed 's/[^0-9]//g')
check "click counter reached 5" "5" "$CLICKS"

UNTOUCHED=$(curl -s "$BASE/" | grep -c 'class="code"')
check "no duplicate rows created" "5" "$UNTOUCHED"
echo

echo "6. Duplicate URLs reuse the same code"
DUP=$(curl -s -X POST "$BASE/api/shorten" -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/some/really/long/path?a=1&b=2"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).code||"")}catch{process.stdout.write("")}})')
check "same URL returns same code" "$CODE" "$DUP"
echo

echo "7. Dashboard sorting (most clicked first)"
FIRST_CODE=$(curl -s "$BASE/" | grep -o 'class="code" href="/[^"]*"' | head -1 | sed 's|.*href="/||;s|"||')
check "top row is the most-clicked seed" "gh4Kp2" "$FIRST_CODE"
echo

echo "8. Unknown codes get a styled 404"
NOT_FOUND_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/zzzzzz")
check "returns 404" "404" "$NOT_FOUND_STATUS"
NOT_FOUND_HTML=$(curl -s "$BASE/zzzzzz")
contains "404 page is styled HTML" "<style>" "$NOT_FOUND_HTML"
contains "404 page names the code" "/zzzzzz" "$NOT_FOUND_HTML"
contains "404 page links home" 'href="/"' "$NOT_FOUND_HTML"
echo

echo "-------------------------------"
printf 'Passed: \033[32m%d\033[0m   Failed: \033[31m%d\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "All tests passed."
