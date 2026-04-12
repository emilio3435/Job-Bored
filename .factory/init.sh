#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

npm --prefix "$REPO_ROOT" run install:repo

mkdir -p "$REPO_ROOT/.factory/library"
mkdir -p "$REPO_ROOT/integrations/browser-use-discovery/state"

# Install pre-commit hook if not present
if [ ! -f "${REPO_ROOT}/.git/hooks/pre-commit" ] && [ -f "${REPO_ROOT}/scripts/pre-commit-hook.sh" ]; then
  cp "${REPO_ROOT}/scripts/pre-commit-hook.sh" "${REPO_ROOT}/.git/hooks/pre-commit"
  chmod +x "${REPO_ROOT}/.git/hooks/pre-commit"
  echo "Pre-commit hook installed."
fi

warn_missing() {
  VAR_NAME="$1"
  eval "VAR_VALUE=\${$VAR_NAME:-}"
  if [ -z "$VAR_VALUE" ]; then
    echo "WARN: ${VAR_NAME} is not set in this shell."
  fi
}

warn_missing "BROWSER_USE_DISCOVERY_WEBHOOK_SECRET"
warn_missing "BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE"
warn_missing "BROWSER_USE_DISCOVERY_GEMINI_API_KEY"

if [ -n "${BROWSER_USE_DISCOVERY_BROWSER_COMMAND:-}" ]; then
  if ! command -v "${BROWSER_USE_DISCOVERY_BROWSER_COMMAND}" >/dev/null 2>&1; then
    echo "WARN: BROWSER_USE_DISCOVERY_BROWSER_COMMAND does not resolve to an executable."
  fi
else
  if ! command -v browser-use >/dev/null 2>&1; then
    echo "WARN: browser-use command is not on PATH."
  fi
fi
