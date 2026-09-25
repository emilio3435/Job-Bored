#!/bin/bash
# Start the sandbox servers every G probe needs (mirror of f227fbb with planted canaries; sandbox HOME).
# Stop: kill $(cat .lane-evidence/devserver.pid) $(cat .lane-evidence/api.pid)
W=$(cd "$(dirname "$0")/../.." && pwd); M=$W/.lane-evidence/probes/mirror
[ -d "$M" ] || { echo "run g-build-mirror.sh first"; exit 1; }
cd "$M"
HOME=$W/.lane-evidence/home PORT=18170 JOBBORED_API_PORT=18171 BROWSER_USE_DISCOVERY_PORT=18172 nohup node dev-server.mjs > $W/.lane-evidence/devserver-18170.log 2>&1 & echo $! > $W/.lane-evidence/devserver.pid
env -u OPENAI_API_KEY -u GEMINI_API_KEY -u ANTHROPIC_API_KEY -u OPENROUTER_API_KEY HOME=$W/.lane-evidence/home PORT=18171 LISTEN_HOST=127.0.0.1 nohup node server/index.mjs > $W/.lane-evidence/api-18171.log 2>&1 & echo $! > $W/.lane-evidence/api.pid
sleep 2; curl -s -o /dev/null -w "dev-server 18170 -> %{http_code}\n" http://127.0.0.1:18170/package.json
