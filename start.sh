#!/usr/bin/env bash
# The whole local stack: dashboard (http://localhost:8080), Cheerio scraper
# (http://127.0.0.1:3847) and the discovery worker (:8644). Same as: npm start
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# --- start opener (SPEC-FIXED C4, GFX-R4) ---
# Opens the dashboard root, never a deep link: the one-flow resumes at its
# own next incomplete beat, and a user who already finished onboarding gets
# the dashboard (GFX-R4 reverts 028b2a2d's ?beat=discovery&returnTo=close).
# C4 flag: JB_SKIP_BROWSER_OPEN=1 skips the browser open.
# Defaults: open ON for interactive/double-click; OFF under CI or headless
# with no TTY unless JB_FORCE_BROWSER_OPEN=1.
JB_DASHBOARD_PORT="${PORT:-8080}"
if [ -n "${COMMAND_CENTER_TLS:-}" ] || [ -n "${HTTPS:-}" ]; then
  JB_DASHBOARD_SCHEME="https"
else
  JB_DASHBOARD_SCHEME="http"
fi
JB_OPEN_URL="${JB_DASHBOARD_SCHEME}://localhost:${JB_DASHBOARD_PORT}/"
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
    printf 'SKIP reason=%s url=%s\n' "$reason" "$JB_OPEN_URL"
  else
    printf 'OPEN url=%s max_wait=%s\n' "$JB_OPEN_URL" "$JB_OPEN_MAX_WAIT_SECS"
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

# --- GFX-N4: who already holds the dashboard port? ---
# Before starting anything, look at :$PORT. A current JobBored build means
# there is nothing to start; an old one has to be stopped first; anything
# else is named (never killed, PLAN R22) so the user knows what to quit.

# "pid command" of the process listening on the port, or nothing.
jb_port_holder() {
  command -v lsof >/dev/null 2>&1 || return 0
  lsof -nP -iTCP:"$JB_DASHBOARD_PORT" -sTCP:LISTEN -Fpc 2>/dev/null |
    awk '/^p/ { pid = substr($0, 2) } /^c/ { print pid, substr($0, 2); exit }'
}

jb_curl() {
  # Bounded, quiet, and keyless: these probes never carry key material.
  curl --max-time 2 --silent --insecure "$@" 2>/dev/null || true
}

# current | old | foreign | free
jb_port_state() {
  local origin="${JB_DASHBOARD_SCHEME}://localhost:${JB_DASHBOARD_PORT}"
  local holder="$1"
  local body code
  if ! command -v curl >/dev/null 2>&1; then
    if [ -n "$holder" ]; then printf 'foreign\n'; else printf 'free\n'; fi
    return 0
  fi
  body="$(jb_curl -H "Origin: ${origin}" "${origin}/__proxy/ping")"
  # The PLAN §R3 ping names its version and the routes it serves.
  if printf '%s' "$body" | grep -q '"version"' &&
    printf '%s' "$body" | grep -q '"serpapi-check"'; then
    printf 'current\n'
    return 0
  fi
  # A JobBored ping from before §R3 ({"ok":true} with no version).
  if printf '%s' "$body" | grep -Eq '^\{"ok":(true|false)'; then
    printf 'old\n'
    return 0
  fi
  code="$(jb_curl --output /dev/null --write-out '%{http_code}' "${origin}/")"
  if [ -z "$holder" ] && { [ -z "$code" ] || [ "$code" = "000" ]; }; then
    printf 'free\n'
    return 0
  fi
  # A JobBored build from before the ping still serves its own dashboard.
  if jb_curl "${origin}/" | head -c 65536 | grep -qi 'JobBored'; then
    printf 'old\n'
    return 0
  fi
  printf 'foreign\n'
}

jb_holder="$(jb_port_holder)"
jb_holder_pid="${jb_holder%% *}"
jb_holder_cmd="${jb_holder#* }"
case "$(jb_port_state "$jb_holder")" in
  current)
    printf 'JobBored is already running at %s\n' "$JB_OPEN_URL"
    if ! jb_skip_reason >/dev/null; then
      jb_open_url "$JB_OPEN_URL" || true
    fi
    exit 0
    ;;
  old)
    printf 'An older JobBored is already running on port %s%s.\n' \
      "$JB_DASHBOARD_PORT" "${jb_holder_pid:+ (process $jb_holder_pid)}"
    printf 'Stop it first: press Ctrl+C in the window where it is running%s, then start JobBored again.\n' \
      "${jb_holder_pid:+, or run: kill $jb_holder_pid}"
    exit 1
    ;;
  foreign)
    printf 'Port %s is already in use by %s%s, which is not JobBored.\n' \
      "$JB_DASHBOARD_PORT" "${jb_holder_cmd:-another program}" \
      "${jb_holder_pid:+ (process $jb_holder_pid)}"
    printf 'Quit that program, then start JobBored again.\n'
    exit 1
    ;;
esac

if skip_reason="$(jb_skip_reason)"; then
  if [ "$skip_reason" = "flag" ]; then
    printf 'Server up. Return to your open tab and press Save & verify.\n'
  fi
else
  jb_wait_then_open "$JB_OPEN_URL"
fi

# Test hook: exercise the real skip/open decision (including the N4 stdout
# line) without replacing this shell with npm start. Skip-path cases launch
# no background jobs, so this exits clean with no daemon.
if [ "${JB_START_NO_EXEC:-}" = "1" ]; then
  printf 'NO_EXEC npm start skipped\n'
  exit 0
fi

exec npm start
