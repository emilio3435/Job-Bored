#!/usr/bin/env bash
# Simulates the server/Dockerfile image layout (build context = server/, filtered by server/.dockerignore)
# without running docker: copies server/ into a scratch /app-like dir and boots it on loopback.
#   bash .lane-evidence/probes/probe-e-docker-sim.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SBX="$ROOT/.lane-evidence/home"; P=18152; B="http://127.0.0.1:$P"
APP="$ROOT/.lane-evidence/docker-sim-$(date +%s)/app"
mkdir -p "$APP"
(cd "$ROOT/server" && tar --exclude='./node_modules' --exclude='./.env' --exclude='./.env.*' --exclude='./npm-debug.log*' -cf - .) | (cd "$APP" && tar -xf -)
ln -s "$ROOT/server/node_modules" "$APP/node_modules"
echo "## image layout: files outside server/ that server code resolves at runtime"
for rel in ../integrations/browser-use-discovery/src/contracts/user-profile.schema.json ../integrations/hermes-job-hunt/scripts/logo_resolver.py ../integrations/hermes-job-hunt/resume-template; do
  test -e "$APP/$rel" && echo "present  $rel" || echo "MISSING  $rel"
done
echo "## .env files in simulated context: $(find "$APP" -maxdepth 1 -name '.env*' | wc -l | tr -d ' ')"
(cd "$APP" && exec env -i PATH="$PATH" HOME="$SBX" PORT=$P LISTEN_HOST=127.0.0.1 JOBBORED_LLM_CONFIG_PATH="$SBX/.jobbored/llm-docker.json" node index.mjs > "$ROOT/.lane-evidence/api-$P.log" 2>&1) &
PID=$!
for i in $(seq 1 50); do curl -s -o /dev/null $B/health && break; sleep 0.2; done
echo "[docker-sim api :$P pid $PID]"
c() { local label="$1"; shift; printf '\n## %s\n' "$label"; curl -s -w '\n[HTTP %{http_code}]' "$@" | head -c 600; echo; }
c "GET /health" $B/health
TPL=$(curl -s -X POST $B/profile/template/engineer)
c "POST /profile/template/engineer (starter template)" -X POST $B/profile/template/engineer
c "POST /profile with starter template body (needs schema from ../integrations)" -X POST -H 'content-type: application/json' --data-binary "$TPL" $B/profile
c "GET /api/brand-logos (default template root ../integrations/hermes-job-hunt/resume-template)" $B/api/brand-logos
kill $PID; for i in $(seq 1 50); do kill -0 $PID 2>/dev/null || break; sleep 0.1; done
echo "[docker-sim stopped]"
echo "## Dockerfile base image python3? node:20-alpine ships no python3 (brand-logo resolver spawns python3):"
grep -n "FROM\|python" "$ROOT/server/Dockerfile"
