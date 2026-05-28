#!/usr/bin/env bash
# Heartbeat writer for any agent. Source this from your agent or call as:
#   bash write.sh <agent-name> <status> "<current_task>"
#
# Example:
#   bash write.sh hermes-job-hunt running "Scoring 3 new postings"
#
# Drops JSON at ~/.agents/<agent-name>.json — the heartbeat server picks
# it up automatically. Call this once per agent activity OR loop it every
# 60 seconds for liveness.
set -euo pipefail

name="${1:-unknown}"
status="${2:-idle}"
task="${3:-}"

dir="${AGENT_HEARTBEAT_DIR:-$HOME/.agents}"
mkdir -p "$dir"

ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$dir/$name.json" <<EOF
{
  "agent": "$name",
  "status": "$status",
  "current_task": "$task",
  "timestamp": "$ts"
}
EOF
