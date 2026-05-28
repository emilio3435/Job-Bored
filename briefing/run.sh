#!/usr/bin/env bash
# Entrypoint called by launchd every 3 hours.
# Resolves the briefing dir from this file's location so it works regardless
# of CWD when launchd fires it.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${BRIEFING_PYTHON:-python3}"

# Optional: activate a venv if one exists next to this script.
if [[ -f "$DIR/.venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "$DIR/.venv/bin/activate"
  PYTHON=python3
fi

cd "$DIR"
exec "$PYTHON" orchestrator.py
