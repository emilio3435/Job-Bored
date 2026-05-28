#!/usr/bin/env bash
# Merge rotated JobBored discovery credentials into the local worker runtime.
# Prints only file paths/key names; never prints secret values.

set -euo pipefail

KEY_DIR="${1:-/Users/emilionunezgarcia/Downloads/Jobbored-Rotated-Keys-2026-05-27}"
JOBBORED_REPO="${JOBBORED_REPO:-$HOME/GitHub/emilio3435/Job-Bored}"
WORKER_DIR="${BROWSER_USE_DISCOVERY_WORKER_DIR:-$JOBBORED_REPO/integrations/browser-use-discovery}"
ENV_FILE="${BROWSER_USE_DISCOVERY_WORKER_ENV:-$WORKER_DIR/.env}"
ROTATED_ENV="$KEY_DIR/private/browser-use-discovery.env"
ROTATED_SERVICE_ACCOUNT="$KEY_DIR/private/service-account-key.json"
WORKER_SERVICE_ACCOUNT="$WORKER_DIR/service-account-key.json"

if [ ! -f "$ROTATED_ENV" ]; then
  echo "ERROR: rotated env file not found: $ROTATED_ENV"
  exit 1
fi

if [ ! -f "$ROTATED_SERVICE_ACCOUNT" ]; then
  echo "ERROR: rotated service-account key not found: $ROTATED_SERVICE_ACCOUNT"
  exit 1
fi

if [ ! -d "$WORKER_DIR" ]; then
  echo "ERROR: worker directory not found: $WORKER_DIR"
  exit 1
fi

mkdir -p "$WORKER_DIR"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

BACKUP="$ENV_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
cp "$ENV_FILE" "$BACKUP"

install -m 600 "$ROTATED_SERVICE_ACCOUNT" "$WORKER_SERVICE_ACCOUNT"

KEYS_TO_MERGE="BROWSER_USE_DISCOVERY_WEBHOOK_SECRET BROWSER_USE_DISCOVERY_GEMINI_API_KEY SERPAPI_API_KEY"

for key in $KEYS_TO_MERGE; do
  value="$(grep -E "^${key}=" "$ROTATED_ENV" | tail -1 | cut -d= -f2- || true)"
  if [ -z "$value" ]; then
    echo "ERROR: $key missing from $ROTATED_ENV"
    exit 1
  fi

  KEY="$key" VALUE="$value" ENV_FILE="$ENV_FILE" python3 -c '
from pathlib import Path
import os

path = Path(os.environ["ENV_FILE"])
key = os.environ["KEY"]
value = os.environ["VALUE"]
lines = path.read_text().splitlines() if path.exists() else []
replacement = f"{key}={value}"
updated = False
out = []
for line in lines:
    if line.startswith(f"{key}="):
        out.append(replacement)
        updated = True
    else:
        out.append(line)
if not updated:
    out.append(replacement)
path.write_text("\n".join(out).rstrip() + "\n")
'
  echo "updated $key in $ENV_FILE"
done

KEY="BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE" VALUE="$WORKER_SERVICE_ACCOUNT" ENV_FILE="$ENV_FILE" python3 -c '
from pathlib import Path
import os

path = Path(os.environ["ENV_FILE"])
key = os.environ["KEY"]
value = os.environ["VALUE"]
lines = path.read_text().splitlines() if path.exists() else []
replacement = f"{key}={value}"
updated = False
out = []
for line in lines:
    if line.startswith(f"{key}="):
        out.append(replacement)
        updated = True
    else:
        out.append(line)
if not updated:
    out.append(replacement)
path.write_text("\n".join(out).rstrip() + "\n")
'

chmod 600 "$ENV_FILE" "$WORKER_SERVICE_ACCOUNT"

echo "updated BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE in $ENV_FILE"
echo "backup: $BACKUP"
echo "service account installed: $WORKER_SERVICE_ACCOUNT"
echo "Restart the discovery worker so it loads the rotated keys."
