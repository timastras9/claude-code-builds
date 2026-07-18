#!/usr/bin/env bash
# Starts the server on a free port, runs two-client WebSocket tests, then cleans up.
set -uo pipefail
cd "$(dirname "$0")"

SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

# Use PORT if the caller set one, otherwise ask the OS for a free port so the
# suite never collides with an unrelated server (or a previous run).
if [ -n "${PORT:-}" ]; then
  TEST_PORT="$PORT"
else
  TEST_PORT=$(node -e "
    const s = require('net').createServer();
    s.listen(0, '127.0.0.1', () => {
      process.stdout.write(String(s.address().port));
      s.close();
    });
  ")
fi

echo "Starting server on port $TEST_PORT..."
PORT="$TEST_PORT" node server.js &
SERVER_PID=$!

# Readiness: poll OUR server's HTTP endpoint, and bail out early if the process
# died (e.g. the port was taken) rather than waiting on a doomed loop.
READY=""
for _ in $(seq 1 50); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "FAIL: server process exited during startup."
    exit 1
  fi
  if node -e "
    fetch('http://127.0.0.1:$TEST_PORT/')
      .then(r => r.text().then(t => process.exit(r.status === 200 && t.includes('<title>') ? 0 : 1)))
      .catch(() => process.exit(1));
  " 2>/dev/null; then
    READY=1
    break
  fi
  sleep 0.2
done

if [ -z "$READY" ]; then
  echo "FAIL: frontend not served at http://127.0.0.1:$TEST_PORT/"
  exit 1
fi
echo "  ok   frontend served over HTTP"

CHAT_URL="ws://127.0.0.1:$TEST_PORT" node test-clients.js
RESULT=$?

if [ $RESULT -eq 0 ]; then
  echo "ALL TESTS PASSED"
else
  echo "TESTS FAILED"
fi

exit $RESULT
