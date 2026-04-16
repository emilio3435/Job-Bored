#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

npm --prefix "$REPO_ROOT" run install:repo

mkdir -p "$REPO_ROOT/.factory/library"
mkdir -p "$REPO_ROOT/.factory/research"
mkdir -p "$REPO_ROOT/integrations/browser-use-discovery/state"

ENV_FILE="$REPO_ROOT/integrations/browser-use-discovery/.env"
if [ ! -f "$ENV_FILE" ] && [ -f "$REPO_ROOT/integrations/browser-use-discovery/.env.example" ]; then
  cp "$REPO_ROOT/integrations/browser-use-discovery/.env.example" "$ENV_FILE"
  echo "Initialized integrations/browser-use-discovery/.env from .env.example"
fi

warn_env_key_missing() {
  KEY="$1"
  if [ ! -f "$ENV_FILE" ]; then
    echo "WARN: $ENV_FILE is missing; cannot verify $KEY"
    return
  fi
  if ! grep -E "^[[:space:]]*${KEY}=" "$ENV_FILE" >/dev/null 2>&1; then
    echo "WARN: ${KEY} is not configured in $ENV_FILE"
  fi
}

warn_env_key_missing "BROWSER_USE_DISCOVERY_WEBHOOK_SECRET"
warn_env_key_missing "BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE"
warn_env_key_missing "BROWSER_USE_DISCOVERY_GEMINI_API_KEY"
warn_env_key_missing "BROWSER_USE_DISCOVERY_BROWSER_COMMAND"
