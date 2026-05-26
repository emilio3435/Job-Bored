#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -n "${JOBBORED_SERVICE_PORTS:-}" ]]; then
  PORTS=(${JOBBORED_SERVICE_PORTS})
else
  PORTS=(
    "${JOBBORED_WEB_PORT:-8080}"
    "${JOBBORED_SCRAPER_PORT:-3847}"
    "${BROWSER_USE_DISCOVERY_PORT:-8644}"
  )
fi

kill_port() {
  local port="$1"
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    printf 'Skipping invalid port: %s\n' "$port" >&2
    return
  fi

  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    printf 'Port %s: no listener\n' "$port"
    return
  fi

  printf 'Port %s: stopping listener(s)\n' "$port"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
  kill $pids 2>/dev/null || true
  sleep 1

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    printf 'Port %s: force-stopping remaining listener(s): %s\n' "$port" "$pids"
    kill -9 $pids 2>/dev/null || true
  fi
}

for port in "${PORTS[@]}"; do
  kill_port "$port"
done

printf '\nStarting JobBored services with npm run dev...\n'
exec npm --prefix "$ROOT_DIR" run dev
