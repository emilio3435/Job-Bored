#!/bin/sh
# A1 reproducer: one unauthenticated `GET //` terminates the discovery worker process.
# Read-only: sandbox HOME under .lane-evidence/home, port 18111, no provider keys, loopback only.
# Run from the worktree root:  sh .lane-evidence/probes/repro-a1-crash.sh
# Expected on f227fbb: "before: health=200", then "after: health=DOWN", "worker process: EXITED",
# and a log line "TypeError: Invalid URL ... server.ts:1021".
PORT=18111
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
sh .lane-evidence/probes/start-worker.sh "$PORT" || exit 1
PID="$(cat ".lane-evidence/logs/worker-$PORT.pid")"
echo "before: health=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health")"
curl -s --path-as-is -o /dev/null "http://127.0.0.1:$PORT//" || true
sleep 1
echo "after: health=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health" || true)" | sed 's/=000$/=DOWN/'
if kill -0 "$PID" 2>/dev/null; then echo "worker process: ALIVE (defect not reproduced)"; kill "$PID"; else echo "worker process: EXITED"; fi
grep -n "TypeError: Invalid URL\|server.ts:1021" ".lane-evidence/logs/worker-$PORT.log" | head -3
