#!/bin/bash
# Spawn redesign lane workers (Codex CLI, gpt-5.5, xhigh reasoning).
#
# Usage:
#   scripts/redesign-spawn-workers.sh                 # dry-run: prints the commands
#   scripts/redesign-spawn-workers.sh --run           # launches all four FE/BE workers in parallel
#   scripts/redesign-spawn-workers.sh --run <lane>    # launches one lane (fe-dashboard|fe-kanban|fe-detail-drawer|be-data-deploy)
#
# Each worker runs `codex exec` non-interactively with its lane's handoff
# doc as the prompt. Output logs go to docs/redesign/logs/<lane>.log.
#
# The integration lane is NOT spawned automatically — it runs AFTER all four
# lanes report completion, invoked manually.

set -eu

RUN_ID="redesign-20260424T0742Z"
BASE="/Users/emilionunezgarcia"
REPO="$BASE/Job-Bored"
HANDOFF_DIR="$REPO/docs/redesign/handoffs"
LOG_DIR="$REPO/docs/redesign/logs"
MODEL="gpt-5.5"
EFFORT="xhigh"

mkdir -p "$LOG_DIR"

# Parallel arrays (bash 3.2-compatible; macOS ships 3.2).
LANE_NAMES=(fe-dashboard fe-kanban fe-detail-drawer be-data-deploy)
LANE_PATHS=(
  "$BASE/Job-Bored-wt-redesign-fe-dashboard"
  "$BASE/Job-Bored-wt-redesign-fe-kanban"
  "$BASE/Job-Bored-wt-redesign-fe-detail-drawer"
  "$BASE/Job-Bored-wt-redesign-be-data-deploy"
)

path_for() {
  local needle="$1"
  local i=0
  local name
  for name in "${LANE_NAMES[@]}"; do
    if [ "$name" = "$needle" ]; then
      echo "${LANE_PATHS[$i]}"
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

prompt_for() {
  local lane="$1"
  local handoff="$HANDOFF_DIR/$lane.md"
  cat <<EOF
You are the \`$lane\` lane worker for run $RUN_ID.

Your brief lives at $handoff. Read it first, then implement.

Hard rules:
- Only edit files your brief says you own. No exceptions without posting a
  handoff note and stopping.
- Preserve every data contract your brief names: Google Sheet write-back,
  resume/cover/ATS generation, discovery webhook, schemas/pipeline-row.v1.json.
- Before you finish, run the verification block in your brief and fill in the
  Completion report section at the bottom of the brief.
- Capture the screenshots your brief lists into docs/redesign/screenshots/.
- Commit on your branch with focused messages; do NOT push.

If you hit real ambiguity that could break a contract, stop and write a
handoff note into your brief with what you need; do not guess.
EOF
}

launch() {
  local lane="$1"
  local wt
  wt="$(path_for "$lane")"
  local log="$LOG_DIR/$lane.log"
  local prompt
  prompt="$(prompt_for "$lane")"

  echo "[$lane] $wt -> $log"
  # nohup + stdin redirect from /dev/null so the child survives when the
  # orchestrator shell exits; otherwise SIGHUP from the parent TTY reaches
  # codex and shows up as "turn interrupted" in the log.
  nohup codex exec \
      -m "$MODEL" \
      -c "model_reasoning_effort=\"$EFFORT\"" \
      -C "$wt" \
      -s workspace-write \
      --add-dir "$REPO/docs/redesign" \
      --color never \
      "$prompt" \
    </dev/null >"$log" 2>&1 &
  echo "[$lane] pid=$!"
}

dry_run() {
  local i=0
  local lane
  for lane in "${LANE_NAMES[@]}"; do
    echo "---- $lane ----"
    echo "codex exec -m $MODEL -c model_reasoning_effort=\"$EFFORT\" \\"
    echo "  -C ${LANE_PATHS[$i]} \\"
    echo "  -s workspace-write --add-dir $REPO/docs/redesign \\"
    echo "  <prompt derived from $HANDOFF_DIR/$lane.md>"
    echo
    i=$((i + 1))
  done
}

case "${1:-}" in
  --run)
    if [ -n "${2:-}" ]; then
      lane="$2"
      if ! path_for "$lane" >/dev/null; then
        echo "unknown lane: $lane" >&2
        exit 2
      fi
      launch "$lane"
      wait
    else
      for lane in "${LANE_NAMES[@]}"; do launch "$lane"; done
      echo "All four lane workers launched. Tail logs in $LOG_DIR/*.log."
      echo "Waiting on all..."
      wait
      echo "All lanes exited. Inspect each handoff's Completion report before running integration."
    fi
    ;;
  "" | --dry-run)
    dry_run
    ;;
  *)
    echo "usage: $0 [--dry-run] | --run [lane]" >&2
    exit 2
    ;;
esac
