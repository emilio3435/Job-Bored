#!/bin/bash
# Spawn dossier Direction F lane workers.
#
# Frontend lanes run via Factory Droid (Claude Opus, max reasoning).
# Backend lanes run via Codex CLI (gpt-5.5, xhigh reasoning).
#
# Usage:
#   scripts/dossier-df-spawn-workers.sh                 # dry-run: prints commands
#   scripts/dossier-df-spawn-workers.sh --run           # launches all 5 phase-1 lanes in parallel
#   scripts/dossier-df-spawn-workers.sh --run <lane>    # launches one lane
#   scripts/dossier-df-spawn-workers.sh --phase2        # launches integration + tests-screens sequentially
#
# Logs:  docs/redesign/logs/dossier-df-<lane>.log
# Status: docs/redesign/status/dossier-df-<lane>.json (written by the worker)

set -eu

RUN_ID="dossier-df-20260519T2030Z"
BASE="/Users/emilionunezgarcia"
REPO="$BASE/Job-Bored"
HANDOFF_DIR="$REPO/docs/redesign/handoffs"
LOG_DIR="$REPO/docs/redesign/logs"
STATUS_DIR="$REPO/docs/redesign/status"

# Backend (Codex CLI) defaults
CODEX_MODEL="gpt-5.5"
CODEX_EFFORT="xhigh"

# Frontend (Factory Droid) defaults.
# Confirmed from `droid exec --help`:
#   - subcommand is `exec`, not `task`
#   - model id for Claude Opus is `claude-opus-4-7`; supported reasoning includes `max`
#   - `--auto medium` is the lowest level that lets the worker create/modify files in the worktree
#   - there is no `--add-dir`; the cwd is set via `--cwd` and the worker may read anywhere reachable from it
DROID_MODEL="claude-opus-4-7"
DROID_REASONING="max"
DROID_AUTO="medium"
DROID_OUTPUT="text"

mkdir -p "$LOG_DIR" "$STATUS_DIR"

# ---- lane definitions ---------------------------------------------------------
# Parallel arrays (bash 3.2-compatible).
PHASE1_LANES=(ats-state-bus writeback-bridge css brief workshop)
PHASE1_PATHS=(
  "$BASE/Job-Bored-wt-dossier-df-ats-bus"
  "$BASE/Job-Bored-wt-dossier-df-writeback"
  "$BASE/Job-Bored-wt-dossier-df-css"
  "$BASE/Job-Bored-wt-dossier-df-brief"
  "$BASE/Job-Bored-wt-dossier-df-workshop"
)
# "fe" or "be" — determines which CLI to use
PHASE1_KINDS=(be be fe fe fe)

PHASE2_LANES=(integration tests-screens)
PHASE2_PATHS=(
  "$BASE/Job-Bored-wt-dossier-df-integration"
  "$BASE/Job-Bored-wt-dossier-df-qa"
)
PHASE2_KINDS=(be fe)

# ---- lookup helpers -----------------------------------------------------------

lookup_phase1() {
  local needle="$1"
  local i=0
  for name in "${PHASE1_LANES[@]}"; do
    if [ "$name" = "$needle" ]; then
      echo "${PHASE1_PATHS[$i]}|${PHASE1_KINDS[$i]}"
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

lookup_phase2() {
  local needle="$1"
  local i=0
  for name in "${PHASE2_LANES[@]}"; do
    if [ "$name" = "$needle" ]; then
      echo "${PHASE2_PATHS[$i]}|${PHASE2_KINDS[$i]}"
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

handoff_name_for() {
  # e.g. lane "ats-state-bus" -> "dossier-df-ats-state-bus.md"
  echo "dossier-df-$1.md"
}

prompt_for() {
  local lane="$1"
  local handoff
  handoff="$HANDOFF_DIR/$(handoff_name_for "$lane")"
  cat <<EOF
You are the \`$lane\` lane worker for run $RUN_ID.

Your brief lives at $handoff. Read it first, then implement.

Hard rules:
- Only edit files your brief says you own. No exceptions without writing a
  status entry and stopping.
- Preserve every data contract your brief names: Google Sheet write-back,
  resume/cover/ATS generation, discovery webhook, schemas/pipeline-row.v1.json,
  and the four event contracts in AGENT_CONTRACT.md (jb:ats:state,
  jb:ats:state:request, jb:ats:modal:open, jb:role:writeback).
- The visual source of truth is docs/redesign/dossier-direction-f-wireframe.html.
  Diff your output against it.
- Run the verification block in your brief before finishing.
- Write your status JSON to $STATUS_DIR/dossier-df-$lane.json on completion.
- Fill in the Completion Report at the bottom of your handoff doc.
- Commit on your branch with focused messages; do NOT push.

If you hit real ambiguity that could break a contract, stop and write a
status entry with what you need; do not guess.
EOF
}

# ---- launchers ----------------------------------------------------------------

launch_codex() {
  local lane="$1" wt="$2"
  local log="$LOG_DIR/dossier-df-$lane.log"
  local prompt
  prompt="$(prompt_for "$lane")"
  echo "[$lane] codex (gpt-5.5/xhigh) $wt -> $log"
  nohup codex exec \
      -m "$CODEX_MODEL" \
      -c "model_reasoning_effort=\"$CODEX_EFFORT\"" \
      -C "$wt" \
      -s workspace-write \
      --add-dir "$REPO/docs/redesign" \
      --color never \
      "$prompt" \
    </dev/null >"$log" 2>&1 &
  echo "[$lane] pid=$!"
}

launch_droid() {
  local lane="$1" wt="$2"
  local log="$LOG_DIR/dossier-df-$lane.log"
  local prompt
  prompt="$(prompt_for "$lane")"
  echo "[$lane] droid (claude-opus-4-7 / $DROID_REASONING, --auto $DROID_AUTO) $wt -> $log"
  nohup droid exec \
      --model "$DROID_MODEL" \
      --reasoning-effort "$DROID_REASONING" \
      --auto "$DROID_AUTO" \
      --output-format "$DROID_OUTPUT" \
      --cwd "$wt" \
      "$prompt" \
    </dev/null >"$log" 2>&1 &
  echo "[$lane] pid=$!"
}

launch() {
  local lane="$1" wt="$2" kind="$3"
  case "$kind" in
    be) launch_codex "$lane" "$wt" ;;
    fe) launch_droid "$lane" "$wt" ;;
    *)  echo "unknown kind: $kind" >&2; return 2 ;;
  esac
}

# ---- dry-run printer ----------------------------------------------------------

dry_run_phase1() {
  local i=0
  echo "── PHASE 1 (parallel) ──"
  for lane in "${PHASE1_LANES[@]}"; do
    local wt="${PHASE1_PATHS[$i]}"
    local kind="${PHASE1_KINDS[$i]}"
    echo "[$lane] kind=$kind wt=$wt"
    if [ "$kind" = "be" ]; then
      echo "  codex exec -m $CODEX_MODEL -c model_reasoning_effort=\"$CODEX_EFFORT\" \\"
      echo "    -C $wt -s workspace-write --add-dir $REPO/docs/redesign \\"
      echo "    <prompt derived from $HANDOFF_DIR/$(handoff_name_for "$lane")>"
    else
      echo "  droid exec --model $DROID_MODEL --reasoning-effort $DROID_REASONING \\"
      echo "    --auto $DROID_AUTO --output-format $DROID_OUTPUT --cwd $wt \\"
      echo "    <prompt derived from $HANDOFF_DIR/$(handoff_name_for "$lane")>"
    fi
    echo
    i=$((i + 1))
  done
}

dry_run_phase2() {
  local i=0
  echo "── PHASE 2 (sequential, after phase 1 status==completed) ──"
  for lane in "${PHASE2_LANES[@]}"; do
    local wt="${PHASE2_PATHS[$i]}"
    local kind="${PHASE2_KINDS[$i]}"
    echo "[$lane] kind=$kind wt=$wt"
    i=$((i + 1))
  done
}

# ---- entrypoints --------------------------------------------------------------

run_phase1_all() {
  local stagger_secs="${1:-0}"
  local i=0
  for lane in "${PHASE1_LANES[@]}"; do
    if [ "$stagger_secs" -gt 0 ] && [ "$lane" != "css" ] && [ "$i" -gt 0 ]; then
      # css launches first (it's listed third but we special-case it below).
      :
    fi
    i=$((i + 1))
  done

  if [ "$stagger_secs" -gt 0 ]; then
    # Launch css first so the namespaces it creates are visible to brief/workshop
    # the moment those workers start visually diffing against the wireframe.
    local css_idx=-1
    i=0
    for lane in "${PHASE1_LANES[@]}"; do
      if [ "$lane" = "css" ]; then css_idx=$i; fi
      i=$((i + 1))
    done
    if [ "$css_idx" -ge 0 ]; then
      echo "── stagger ON: launching css first, others in ${stagger_secs}s ──"
      launch "css" "${PHASE1_PATHS[$css_idx]}" "${PHASE1_KINDS[$css_idx]}"
      sleep "$stagger_secs"
    fi
    i=0
    for lane in "${PHASE1_LANES[@]}"; do
      if [ "$lane" != "css" ]; then
        launch "$lane" "${PHASE1_PATHS[$i]}" "${PHASE1_KINDS[$i]}"
      fi
      i=$((i + 1))
    done
  else
    i=0
    for lane in "${PHASE1_LANES[@]}"; do
      launch "$lane" "${PHASE1_PATHS[$i]}" "${PHASE1_KINDS[$i]}"
      i=$((i + 1))
    done
  fi

  echo "All 5 phase-1 workers launched. Tail logs in $LOG_DIR/dossier-df-*.log."
  echo "Status JSON drops to $STATUS_DIR/."
  echo "Waiting on all..."
  wait
  echo "Phase 1 exited. Check $STATUS_DIR for completion JSONs before running --phase2."
}

run_phase1_one() {
  local lane="$1"
  local row
  if ! row="$(lookup_phase1 "$lane")"; then
    echo "unknown phase 1 lane: $lane" >&2; exit 2
  fi
  local wt="${row%%|*}"
  local kind="${row##*|}"
  launch "$lane" "$wt" "$kind"
  wait
}

run_phase2() {
  local i=0
  for lane in "${PHASE2_LANES[@]}"; do
    local wt="${PHASE2_PATHS[$i]}"
    local kind="${PHASE2_KINDS[$i]}"
    echo "── launching phase 2 lane: $lane ──"
    launch "$lane" "$wt" "$kind"
    wait  # sequential
    echo "── $lane exited ──"
    i=$((i + 1))
  done
}

# ---- arg parsing --------------------------------------------------------------

case "${1:-}" in
  --run)
    if [ -n "${2:-}" ]; then
      run_phase1_one "$2"
    else
      run_phase1_all 0
    fi
    ;;
  --stagger)
    # css first, others 90s later by default; override with --stagger <seconds>
    stagger="${2:-90}"
    run_phase1_all "$stagger"
    ;;
  --phase2)
    run_phase2
    ;;
  "" | --dry-run)
    dry_run_phase1
    echo
    dry_run_phase2
    ;;
  *)
    echo "usage: $0 [--dry-run] | --run [lane] | --stagger [seconds] | --phase2" >&2
    exit 2
    ;;
esac
