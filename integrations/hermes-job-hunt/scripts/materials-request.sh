#!/usr/bin/env bash
#
# materials-request.sh — wrapper the JobBored server uses to invoke
# Hermes's materials_request.py.
#
# Picks a Python in this order:
#   1. $HERMES_PYTHON if set
#   2. ~/.hermes/job-hunt/.venv/bin/python3 if it exists
#   3. python3 on PATH
#
# Forwards all args to materials_request.py and exits with the same
# code. Pure passthrough so the server doesn't need to know venv
# details.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PY_SCRIPT="$SCRIPT_DIR/materials_request.py"

if [ -n "${HERMES_PYTHON:-}" ] && [ -x "$HERMES_PYTHON" ]; then
  PY="$HERMES_PYTHON"
elif [ -x "$HOME/.hermes/job-hunt/.venv/bin/python3" ]; then
  PY="$HOME/.hermes/job-hunt/.venv/bin/python3"
else
  PY="python3"
fi

exec "$PY" "$PY_SCRIPT" "$@"
