#!/usr/bin/env bash
# Dashboard (http://localhost:8080) + Cheerio scraper (http://127.0.0.1:3847)
# Same as: npm start
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# --- B5 Option 4 start opener (SPEC-FIXED C1 + C4) ---
# C1 deep link: ?beat=discovery (param `beat`, value `discovery`).
# C4 flag: JB_SKIP_BROWSER_OPEN=1 skips the browser open.
# Defaults: open ON for interactive/double-click; OFF under CI or headless
# with no TTY unless JB_FORCE_BROWSER_OPEN=1.
JB_DASHBOARD_PORT="${PORT:-8080}"
if [ -n "${COMMAND_CENTER_TLS:-}" ] || [ -n "${HTTPS:-}" ]; then
  JB_DASHBOARD_SCHEME="https"
else
  JB_DASHBOARD_SCHEME="http"
fi
JB_BEAT_URL="${JB_DASHBOARD_SCHEME}://localhost:${JB_DASHBOARD_PORT}/?beat=discovery"
JB_OPEN_MAX_WAIT_SECS="${JB_OPEN_MAX_WAIT_SECS:-30}"

jb_skip_reason() {
  if [ "${JB_SKIP_BROWSER_OPEN:-}" = "1" ]; then
    printf 'flag\n'
    return 0
  fi
  if [ -n "${CI:-}" ]; then
    printf 'ci\n'
    return 0
  fi
  if [ "${JB_FORCE_BROWSER_OPEN:-}" != "1" ] && [ ! -t 0 ] && [ ! -t 1 ]; then
    printf 'headless\n'
    return 0
  fi
  return 1
}

jb_open_url() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then
    open "$url"
    return $?
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1
    return $?
  fi
  printf 'Open your browser at: %s\n' "$url"
  return 0
}

jb_wait_for_dashboard() {
  # Bounded poll: per-probe curl timeout plus an overall SECONDS deadline.
  # Always returns within max_wait seconds plus one probe; never hangs.
  local health_url="$1"
  local max_wait="$2"
  local deadline=$((SECONDS + max_wait))
  if ! command -v curl >/dev/null 2>&1; then
    sleep 2
    return 1
  fi
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl --max-time 2 --silent --fail --output /dev/null "$health_url" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

jb_wait_then_open() {
  local url="$1"
  local health_url="${JB_DASHBOARD_SCHEME}://localhost:${JB_DASHBOARD_PORT}/"
  (
    set +e
    if jb_wait_for_dashboard "$health_url" "$JB_OPEN_MAX_WAIT_SECS"; then
      jb_open_url "$url"
    else
      # Slow boot: surface the URL once, then exit. No retry daemon.
      jb_open_url "$url"
    fi
  ) &
}

# Test hook: report the open/skip decision without starting servers.
if [ "${JB_START_DRY_RUN:-}" = "1" ]; then
  if reason="$(jb_skip_reason)"; then
    printf 'SKIP reason=%s url=%s\n' "$reason" "$JB_BEAT_URL"
  else
    printf 'OPEN url=%s max_wait=%s\n' "$JB_BEAT_URL" "$JB_OPEN_MAX_WAIT_SECS"
  fi
  exit 0
fi

# Test hook: run only the bounded poll against the dashboard root, then exit.
# Proves the wait cannot hang; never opens a browser, never starts servers.
if [ "${JB_OPEN_POLL_ONLY:-}" = "1" ]; then
  start_secs="$SECONDS"
  health_url="${JB_DASHBOARD_SCHEME}://localhost:${JB_DASHBOARD_PORT}/"
  set +e
  if jb_wait_for_dashboard "$health_url" "$JB_OPEN_MAX_WAIT_SECS"; then
    result="up"
  else
    result="timeout"
  fi
  set -e
  elapsed=$((SECONDS - start_secs))
  printf 'POLL_DONE result=%s elapsed_secs=%s max_wait=%s\n' "$result" "$elapsed" "$JB_OPEN_MAX_WAIT_SECS"
  exit 0
fi

if skip_reason="$(jb_skip_reason)"; then
  if [ "$skip_reason" = "flag" ]; then
    printf 'Server up. Return to your open tab and press Save & verify.\n'
  fi
else
  jb_wait_then_open "$JB_BEAT_URL"
fi

# Test hook: exercise the real skip/open decision (including the N4 stdout
# line) without replacing this shell with npm start. Skip-path cases launch
# no background jobs, so this exits clean with no daemon.
if [ "${JB_START_NO_EXEC:-}" = "1" ]; then
  printf 'NO_EXEC npm start skipped\n'
  exit 0
fi

exec npm start
