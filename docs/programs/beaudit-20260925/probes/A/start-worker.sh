#!/bin/sh
# Start a sandboxed worker on 127.0.0.1:${1:-18110}. Minimal env (env -i): no provider keys, sandbox HOME.
# Usage (from worktree root): sh .lane-evidence/probes/start-worker.sh [port]
# Stop:  kill "$(cat .lane-evidence/logs/worker-<port>.pid)"
# Extra env for the worker can be passed as EXTRA_ENV="K=V K2=V2".
PORT_ARG="${1:-18110}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$ROOT/.lane-evidence/logs/worker-$PORT_ARG.log"
mkdir -p "$ROOT/.lane-evidence/home" "$ROOT/.lane-evidence/logs"
cd "$ROOT" || exit 1
rm -f "$LOG"
# shellcheck disable=SC2086
env -i PATH="$PATH" HOME="$ROOT/.lane-evidence/home" \
  BROWSER_USE_DISCOVERY_PORT="$PORT_ARG" BROWSER_USE_DISCOVERY_HOST=127.0.0.1 \
  BROWSER_USE_DISCOVERY_WEBHOOK_SECRET=probe-secret $EXTRA_ENV \
  node --experimental-strip-types integrations/browser-use-discovery/src/server.ts \
  >>"$LOG" 2>&1 &
echo $! >>"$ROOT/.lane-evidence/logs/worker-$PORT_ARG.pid.new"
mv "$ROOT/.lane-evidence/logs/worker-$PORT_ARG.pid.new" "$ROOT/.lane-evidence/logs/worker-$PORT_ARG.pid"
i=0
while [ $i -lt 40 ]; do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT_ARG/health"; then
    echo "worker up on $PORT_ARG pid $(cat "$ROOT/.lane-evidence/logs/worker-$PORT_ARG.pid")"
    exit 0
  fi
  i=$((i + 1))
  sleep 0.5
done
echo "worker failed to start"
tail -20 "$LOG"
exit 1
