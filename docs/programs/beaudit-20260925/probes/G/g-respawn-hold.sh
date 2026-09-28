#!/bin/bash
# Probe G: at f227fbb the starter "reuses" a healthy worker and then never re-probes it.
# Kill the reused worker -> the starter stays alive holding nothing; port stays dead.
W=$(cd "$(dirname "$0")/../.." && pwd); M=$W/.lane-evidence/probes/mirror; P=18173
node $W/.lane-evidence/probes/g-fake-worker.mjs $P > $W/.lane-evidence/fake-worker.log 2>&1 & FW=$!; sleep 0.7
( cd $M && HOME=$W/.lane-evidence/home BROWSER_USE_DISCOVERY_PORT=$P node scripts/start-discovery-worker-local.mjs > $W/.lane-evidence/starter-hold.log 2>&1 ) & ST=$!; sleep 2
echo "starter log:"; cat $W/.lane-evidence/starter-hold.log
kill $FW; echo "killed reused worker pid=$FW; waiting 12s"; sleep 12
STPID=$(pgrep -f "scripts/start-discovery-worker-local.mjs" -P $ST 2>/dev/null || true)
echo "starter subshell alive: $(kill -0 $ST 2>/dev/null && echo yes || echo no)"
echo "listener on $P: $(lsof -nP -iTCP:$P -sTCP:LISTEN -t | tr '\n' ' ')(empty = nothing)"
curl -s -o /dev/null -w "health on $P -> %{http_code}\n" http://127.0.0.1:$P/health
echo "starter log after kill:"; cat $W/.lane-evidence/starter-hold.log
pkill -P $ST 2>/dev/null; kill $ST 2>/dev/null; true
