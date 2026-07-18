#!/usr/bin/env bash
#
# End-to-end API tests: auth + notes CRUD driven through curl with a cookie jar.
# Runs against a throwaway database on its own port, so it never touches dev data.

set -uo pipefail
cd "$(dirname "$0")"

PORT=3117
BASE="http://localhost:$PORT"
TMP="$(mktemp -d)"
DB="$TMP/test.db"
JAR="$TMP/cookies.txt"
JAR2="$TMP/cookies2.txt"
STATUS_FILE="$TMP/status"

PASS=0
FAIL=0

cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null
  wait "${SERVER_PID:-}" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

ok()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; printf '      %s\n' "${2:-}"; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# check <label> <actual> <expected>
check() {
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1" "expected [$3], got [$2]"; fi
}

# req <METHOD> <path> [json] [jar]  -> prints body, records the status code.
# The status goes to a file, not a variable: req is usually called as
# BODY=$(req ...), and a subshell can't assign back into this shell.
req() {
  local jar="${4:-$JAR}" out
  if [[ -n "${3:-}" ]]; then
    out=$(curl -sS -w '\n%{http_code}' -X "$1" "$BASE$2" \
      -b "$jar" -c "$jar" -H 'Content-Type: application/json' -d "$3")
  else
    out=$(curl -sS -w '\n%{http_code}' -X "$1" "$BASE$2" -b "$jar" -c "$jar")
  fi
  printf '%s' "${out##*$'\n'}" > "$STATUS_FILE"
  printf '%s' "${out%$'\n'*}"
}

# Status code of the most recent req.
st() { cat "$STATUS_FILE"; }

# JSON field off stdin, via node (no jq dependency).
field() { node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    try{ const v=eval("(" + s + ")" + process.argv[1]); console.log(v===undefined?"":v);}
    catch(e){ console.log("PARSE_ERROR"); }
  });' "$1"; }

# ---------------------------------------------------------------- boot ----

printf '\033[1mNotes API test suite\033[0m\n'

DB_PATH="$DB" PORT="$PORT" SESSION_SECRET=test-secret node server.js >"$TMP/server.log" 2>&1 &
SERVER_PID=$!

for i in $(seq 1 50); do
  curl -sf "$BASE/api/me" -o /dev/null 2>/dev/null && break
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/me" 2>/dev/null)" == "401" ]] && break
  sleep 0.2
done

if ! curl -sS -o /dev/null "$BASE/api/me" 2>/dev/null; then
  echo "server failed to start:"; cat "$TMP/server.log"; exit 1
fi

# ---------------------------------------------------------------- auth ----

section 'Auth'

req GET /api/notes >/dev/null
check 'unauthenticated GET /api/notes is rejected' "$(st)" 401

req POST /api/login '{"username":"demo","password":"wrong"}' >/dev/null
check 'login with a bad password is rejected'      "$(st)" 401

req POST /api/login '{"username":"nobody","password":"demo1234"}' >/dev/null
check 'login as an unknown user is rejected'       "$(st)" 401

BODY=$(req POST /api/login '{"username":"demo","password":"demo1234"}')
check 'demo user can log in'                       "$(st)" 200
check 'login returns the username'                 "$(printf '%s' "$BODY" | field .username)" demo

BODY=$(req GET /api/me)
check 'session persists via the cookie jar'        "$(st)" 200
check '/api/me reports the signed-in user'         "$(printf '%s' "$BODY" | field .username)" demo

req POST /api/signup '{"username":"demo","password":"another1"}' >/dev/null
check 'duplicate username is rejected'             "$(st)" 409

req POST /api/signup '{"username":"shortpw","password":"abc"}' >/dev/null
check 'too-short password is rejected'             "$(st)" 400

# ------------------------------------------------------------ seed data ----

section 'Seed data'

BODY=$(req GET /api/notes)
check 'notes list is readable when signed in'      "$(st)" 200
check 'demo user has 6 seeded notes'               "$(printf '%s' "$BODY" | field .length)" 6
check 'seeded notes are pinned-first'              "$(printf '%s' "$BODY" | field '[0].pinned')" true

# ----------------------------------------------------------------- CRUD ----

section 'Notes CRUD'

BODY=$(req POST /api/notes '{"title":"Test note","body":"created by test.sh"}')
check 'create returns 201'                         "$(st)" 201
ID=$(printf '%s' "$BODY" | field .id)
check 'create echoes the title'                    "$(printf '%s' "$BODY" | field .title)" 'Test note'
check 'a new note starts unpinned'                 "$(printf '%s' "$BODY" | field .pinned)" false

req POST /api/notes '{"title":"","body":"  "}' >/dev/null
check 'an empty note is rejected'                  "$(st)" 400

BODY=$(req GET /api/notes)
check 'the new note appears in the list'           "$(printf '%s' "$BODY" | field .length)" 7

BODY=$(req PUT "/api/notes/$ID" '{"title":"Edited title","body":"edited body"}')
check 'update returns 200'                         "$(st)" 200
check 'update persists the title'                  "$(printf '%s' "$BODY" | field .title)" 'Edited title'
check 'update persists the body'                   "$(printf '%s' "$BODY" | field .body)" 'edited body'

BODY=$(req PUT "/api/notes/$ID" '{"pinned":true}')
check 'a note can be pinned'                       "$(printf '%s' "$BODY" | field .pinned)" true
check 'pinning leaves the title alone'             "$(printf '%s' "$BODY" | field .title)" 'Edited title'

BODY=$(req GET /api/notes)
check 'a pinned note sorts to the top'             "$(printf '%s' "$BODY" | field '[0].id')" "$ID"

BODY=$(req PUT "/api/notes/$ID" '{"pinned":false}')
check 'a note can be unpinned'                     "$(printf '%s' "$BODY" | field .pinned)" false

req PUT /api/notes/999999 '{"title":"ghost"}' >/dev/null
check 'updating a missing note gives 404'          "$(st)" 404

# --------------------------------------------------------------- search ----

section 'Search'

BODY=$(req GET '/api/notes?q=Edited')
check 'search finds a matching note'               "$(printf '%s' "$BODY" | field .length)" 1
check 'search returns the right note'              "$(printf '%s' "$BODY" | field '[0].id')" "$ID"

BODY=$(req GET '/api/notes?q=edited%20body')
check 'search matches on body text'                "$(printf '%s' "$BODY" | field .length)" 1

BODY=$(req GET '/api/notes?q=zzzznomatch')
check 'search with no hits returns empty'          "$(printf '%s' "$BODY" | field .length)" 0

# ------------------------------------------------------------ isolation ----

section 'User isolation'

BODY=$(req POST /api/signup '{"username":"tester","password":"testpass1"}' "$JAR2")
check 'a second user can sign up'                  "$(st)" 201

BODY=$(req GET /api/notes "" "$JAR2")
check 'the new user starts with no notes'          "$(printf '%s' "$BODY" | field .length)" 0

BODY=$(req GET "/api/notes?q=Edited" "" "$JAR2")
check "the new user cannot search another user's notes" "$(printf '%s' "$BODY" | field .length)" 0

req PUT "/api/notes/$ID" '{"title":"hijacked"}' "$JAR2" >/dev/null
check "another user cannot edit someone else's note"   "$(st)" 404

req DELETE "/api/notes/$ID" "" "$JAR2" >/dev/null
check "another user cannot delete someone else's note" "$(st)" 404

BODY=$(req GET "/api/notes?q=Edited")
check 'the note survived the hijack attempts'      "$(printf '%s' "$BODY" | field '[0].title')" 'Edited title'

# --------------------------------------------------------------- delete ----

section 'Delete + logout'

req DELETE "/api/notes/$ID" >/dev/null
check 'delete returns 200'                         "$(st)" 200

BODY=$(req GET /api/notes)
check 'the deleted note is gone'                   "$(printf '%s' "$BODY" | field .length)" 6

req DELETE "/api/notes/$ID" >/dev/null
check 'deleting twice gives 404'                   "$(st)" 404

req POST /api/logout '{}' >/dev/null
check 'logout succeeds'                            "$(st)" 200

req GET /api/notes >/dev/null
check 'the session is dead after logout'           "$(st)" 401

# -------------------------------------------------------------- summary ----

printf '\n────────────────────────────\n'
if [[ $FAIL -eq 0 ]]; then
  printf '\033[32mAll %d tests passed.\033[0m\n\n' "$PASS"
  exit 0
else
  printf '\033[31m%d passed, %d failed.\033[0m\n\n' "$PASS" "$FAIL"
  exit 1
fi
