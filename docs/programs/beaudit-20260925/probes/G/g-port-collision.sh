#!/bin/bash
# Probe G: a non-worker (Hermes-gateway-shaped) listener owns the worker port. What does `npm run start:discovery-worker` print?
W=$(cd "$(dirname "$0")/../.." && pwd); M=$W/.lane-evidence/probes/mirror; P=18175
node -e 'require("http").createServer((q,s)=>{s.writeHead(404);s.end("hermes gateway")}).listen('$P',"127.0.0.1")' & FW=$!; sleep 0.7
( cd $M && HOME=$W/.lane-evidence/home BROWSER_USE_DISCOVERY_PORT=$P BROWSER_USE_DISCOVERY_WEBHOOK_SECRET=probe-secret timeout 25 node scripts/start-discovery-worker-local.mjs ) > $W/.lane-evidence/starter-collision.log 2>&1; echo "starter exit=$?"
kill $FW
grep -v "^\s*at " $W/.lane-evidence/starter-collision.log | head -40
