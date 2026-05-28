#!/usr/bin/env bash
# discovery-trigger.sh — Trigger the JobBored discovery worker via webhook
#
# This script is designed for Hermes cron (no_agent=true, stdout delivered verbatim).
# It ensures the worker is running, gets a fresh OAuth token, POSTs the webhook,
# and reports results.
#
# Exit codes:
#   0 = success (stdout = report)
#   1 = fatal error (stdout = error message)
#
# OSS note: sheetId comes from worker-config.json (set during onboarding),
# webhook secret from .env, OAuth token from Hermes google_token.json.
# Nothing is hardcoded.

set -euo pipefail

# ─── Configuration (all from environment/config, nothing hardcoded) ─────
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
HERMES_JOB_HUNT_HOME="${HERMES_JOB_HUNT_HOME:-$HERMES_HOME/job-hunt}"
JOBBORED_REPO="${JOBBORED_REPO:-$HOME/Job-Bored}"
WORKER_DIR="${BROWSER_USE_DISCOVERY_WORKER_DIR:-$JOBBORED_REPO/integrations/browser-use-discovery}"
WORKER_CONFIG="${BROWSER_USE_DISCOVERY_WORKER_CONFIG:-$WORKER_DIR/state/worker-config.json}"
WORKER_ENV="${BROWSER_USE_DISCOVERY_WORKER_ENV:-$WORKER_DIR/.env}"
if [ -n "${HERMES_PYTHON:-}" ]; then
  PYTHON_BIN="$HERMES_PYTHON"
elif [ -x "$HERMES_JOB_HUNT_HOME/.venv/bin/python" ]; then
  PYTHON_BIN="$HERMES_JOB_HUNT_HOME/.venv/bin/python"
else
  PYTHON_BIN="python3"
fi

# Worker HTTP config
WORKER_PORT="${BROWSER_USE_DISCOVERY_PORT:-8644}"
WORKER_HOST="127.0.0.1"
WORKER_URL="http://${WORKER_HOST}:${WORKER_PORT}"
HEALTH_URL="${WORKER_URL}/health"
WEBHOOK_URL="${WORKER_URL}/webhook"

# ─── Read required values from config files ─────────────────────────────
SHEET_ID=$("$PYTHON_BIN" -c "import json; print(json.load(open('$WORKER_CONFIG'))['sheetId'])" 2>/dev/null || echo "")
if [ -z "$SHEET_ID" ]; then
  echo "ERROR: sheetId is empty in $WORKER_CONFIG. Complete JobBored onboarding first."
  exit 1
fi

# Read webhook secret from .env
WEBHOOK_SECRET=""
if [ -f "$WORKER_ENV" ]; then
  WEBHOOK_SECRET=$(grep -E '^BROWSER_USE_DISCOVERY_WEBHOOK_SECRET=' "$WORKER_ENV" | head -1 | cut -d'=' -f2- | tr -d '"' || true)
fi
if [ -z "$WEBHOOK_SECRET" ]; then
  echo "ERROR: No webhook secret found in $WORKER_ENV"
  exit 1
fi

# ─── Ensure worker is running ───────────────────────────────────────────
if ! curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
  echo "Worker not running on port $WORKER_PORT. Starting..."
  cd "$WORKER_DIR"
  # Source .env for the worker process
  set -a; source "$WORKER_ENV" 2>/dev/null || true; set +a
  # Pass service account explicitly — .env variable expansion doesn't reach Node process.env
  nohup env BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE="${BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE:-}" node --experimental-strip-types src/server.ts > /tmp/jobbored-worker.log 2>&1 &
  WORKER_PID=$!
  # Wait up to 15 seconds for startup
  for i in $(seq 1 15); do
    if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$WORKER_PID" 2>/dev/null; then
      echo "ERROR: Worker process died during startup. Check /tmp/jobbored-worker.log"
      tail -20 /tmp/jobbored-worker.log 2>/dev/null || true
      exit 1
    fi
    sleep 1
  done
  if ! curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "ERROR: Worker did not become healthy within 15 seconds"
    exit 1
  fi
  echo "Worker started (PID $WORKER_PID)"
fi

# ─── Get fresh Google OAuth access token ─────────────────────────────────
# Try to get a token via the google-workspace skill's token file
ACCESS_TOKEN=""
if [ -f "$HERMES_HOME/google_token.json" ]; then
  ACCESS_TOKEN=$($PYTHON_BIN -c "
import json, sys
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
creds = Credentials.from_authorized_user_file('$HERMES_HOME/google_token.json')
if creds.expired and creds.refresh_token:
    creds.refresh(Request())
    with open('$HERMES_HOME/google_token.json', 'w') as f:
        f.write(creds.to_json())
print(creds.token)
" 2>/dev/null || echo "")
fi

# ─── POST discovery webhook ─────────────────────────────────────────────
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Build discoveryProfile from worker-config.json (webhook expects these in the payload)
PAYLOAD=$("$PYTHON_BIN" -c "
import json

config = json.load(open('$WORKER_CONFIG'))
d = {
    'event': 'command-center.discovery',
    'schemaVersion': 1,
    'sheetId': config.get('sheetId', ''),
    'variationKey': config.get('sheetId', ''),
    'requestedAt': '$NOW',
    'trigger': 'scheduled-local',
    'discoveryProfile': {
        'targetRoles': ', '.join(config.get('targetRoles', [])),
        'keywordsInclude': ', '.join(config.get('includeKeywords', [])),
        'keywordsExclude': ', '.join(config.get('excludeKeywords', [])),
        'locations': ', '.join(config.get('locations', [])),
        'remotePolicy': config.get('remotePolicy', ''),
        'seniority': config.get('seniority', ''),
        'maxLeadsPerRun': str(config.get('maxLeadsPerRun', 25)),
    },
}
tok = '$ACCESS_TOKEN'
if tok:
    d['googleAccessToken'] = tok
print(json.dumps(d))
")

RESPONSE=$(curl -sf -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-discovery-secret: $WEBHOOK_SECRET" \
  -d "$PAYLOAD" \
  --max-time 300 2>&1) || {
    echo "ERROR: Webhook POST failed"
    echo "$RESPONSE"
    exit 1
  }

# ─── Parse and report ───────────────────────────────────────────────────
OK=$(echo "$RESPONSE" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('ok', False))" 2>/dev/null || echo "False")

if [ "$OK" = "True" ]; then
  # Extract run ID for polling if async
  RUN_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('runId',''))" 2>/dev/null || echo "")

  if [ -n "$RUN_ID" ]; then
    # Async mode — poll for completion (up to 10 minutes)
    for i in $(seq 1 60); do
      sleep 10
      STATUS_RESP=$(curl -sf "${WORKER_URL}/runs/${RUN_ID}" 2>/dev/null || echo '{}')
      STATUS=$(echo "$STATUS_RESP" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('status','unknown'))" 2>/dev/null || echo "unknown")
      if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
        break
      fi
    done
  fi

  # ─── Read Pipeline for new jobs and format Telegram notification ───────
  # Fetch current Pipeline data via Sheets API or CSV fallback
  "$PYTHON_BIN" -c "
import json, sys, os
from datetime import datetime, timedelta

SHEET_ID = '$SHEET_ID'
HERMES_HOME = os.path.expanduser('$HERMES_HOME')

# Try Sheets API first, fall back to CSV
rows = []
try:
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    creds = Credentials.from_authorized_user_file(f'{HERMES_HOME}/google_token.json')
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    service = build('sheets', 'v4', credentials=creds)
    result = service.spreadsheets().values().get(
        spreadsheetId=SHEET_ID,
        range='Pipeline!A1:M500'
    ).execute()
    rows = result.get('values', [])
except Exception as e:
    # CSV fallback
    import urllib.request
    url = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Pipeline&range=A1:M500'
    import csv, io
    resp = urllib.request.urlopen(url, timeout=30).read().decode()
    rows = list(csv.reader(io.StringIO(resp)))

if len(rows) < 2:
    print('No Pipeline data found.')
    sys.exit(0)

headers = rows[0]
# Find column indices
col_map = {}
for i, h in enumerate(headers):
    col_map[h.strip()] = i

date_col = col_map.get('Date Found', 0)
title_col = col_map.get('Title', 1)
company_col = col_map.get('Company', 2)
location_col = col_map.get('Location', 3)
link_col = col_map.get('Link', 4)
salary_col = col_map.get('Salary', 6)
score_col = col_map.get('Fit Score', 7)
status_col = col_map.get('Status', 12)

# Find new rows (Status = 'New' or recently added)
new_jobs = []
today = datetime.now().strftime('%Y-%m-%d')
yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

for row in rows[1:]:
    if len(row) <= status_col:
        continue
    status = row[status_col].strip() if len(row) > status_col else ''
    date = row[date_col].strip() if len(row) > date_col else ''

    if status == 'New' or (status == '' and date in (today, yesterday)):
        title = row[title_col].strip() if len(row) > title_col else '?'
        company = row[company_col].strip() if len(row) > company_col else '?'
        location = row[location_col].strip() if len(row) > location_col else '?'
        link = row[link_col].strip() if len(row) > link_col else ''
        salary = row[salary_col].strip() if len(row) > salary_col else ''
        score = row[score_col].strip() if len(row) > score_col else ''
        new_jobs.append({
            'title': title, 'company': company, 'location': location,
            'link': link, 'salary': salary, 'score': score, 'date': date,
        })

if not new_jobs:
    # Silent — no new jobs, no notification needed
    sys.exit(0)

# Format Telegram notification
lines = []
lines.append(f'🔍 JobBored Discovery — {len(new_jobs)} new lead{\"s\" if len(new_jobs) != 1 else \"\"}')
lines.append('')

# Sort by fit score descending
new_jobs.sort(key=lambda j: int(j['score']) if j['score'].isdigit() else 0, reverse=True)

for i, job in enumerate(new_jobs[:10]):
    emoji = '⭐' if job['score'] and int(job['score']) >= 7 else '📋'
    score_str = f' | Score: {job[\"score\"]}/10' if job['score'] else ''
    salary_str = f' | {job[\"salary\"]}' if job['salary'] else ''
    lines.append(f'{emoji} {job[\"title\"]} @ {job[\"company\"]}')
    lines.append(f'   📍 {job[\"location\"]}{salary_str}{score_str}')
    if job['link']:
        lines.append(f'   🔗 {job[\"link\"]}')
    lines.append('')

if len(new_jobs) > 10:
    lines.append(f'... and {len(new_jobs) - 10} more in the Pipeline.')
    lines.append('')

lines.append('To approve a job for research, reply:')
lines.append('  YES <COMPANY>')
lines.append('or set Status → Researching in the Sheet.')

print('\\n'.join(lines))
"
else
  echo "ERROR: Discovery webhook returned ok=false"
  echo "$RESPONSE" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('message','unknown error'))" 2>/dev/null || echo "$RESPONSE"
  exit 1
fi
