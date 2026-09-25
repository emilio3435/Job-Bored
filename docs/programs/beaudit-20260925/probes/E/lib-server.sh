# Source me. start_api <port> [extra env...] ; stop_api
# Starts server/index.mjs with a scrubbed env (no ambient provider keys) and sandbox HOME.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SBX="$ROOT/.lane-evidence/home"
start_api() {
  local port="$1"; shift
  mkdir -p "$SBX/.jobbored"
  if curl -s -o /dev/null "http://127.0.0.1:$port/health" 2>/dev/null; then echo "[port $port already in use; refusing]"; return 1; fi
  (cd "$ROOT" && exec env -i PATH="$PATH" HOME="$SBX" PORT="$port" LISTEN_HOST="${LISTEN_HOST:-127.0.0.1}" \
     JOBBORED_LLM_CONFIG_PATH="${JOBBORED_LLM_CONFIG_PATH:-$SBX/.jobbored/llm.json}" \
     HERMES_RESUME_TEMPLATE_DIR="$SBX/tpl-$port-$(date +%s)" "$@" \
     node server/index.mjs > "$ROOT/.lane-evidence/api-$port.log" 2>&1 &
   echo $! > "$ROOT/.lane-evidence/api-$port.pid")
  for i in $(seq 1 50); do
    curl -s -o /dev/null "http://127.0.0.1:$port/health" 2>/dev/null && { echo "[api :$port up pid $(cat "$ROOT/.lane-evidence/api-$port.pid")]"; return 0; }
    sleep 0.2
  done
  echo "[api :$port FAILED to start]"; cat "$ROOT/.lane-evidence/api-$port.log"; return 1
}
stop_api() {
  local port="$1" pid; pid="$(cat "$ROOT/.lane-evidence/api-$port.pid")"
  kill "$pid" 2>/dev/null
  for i in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  echo "[api :$port stopped pid $pid]"
}
