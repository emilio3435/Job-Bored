#!/bin/bash
# Bootstrap worktrees + branches for the dossier Direction F swarm.
#
# Creates seven sibling worktrees off feat/flowing-page, one per lane.
#
# Usage:
#   scripts/dossier-df-bootstrap-worktrees.sh                # dry-run: prints the git commands
#   scripts/dossier-df-bootstrap-worktrees.sh --run          # creates the worktrees
#   scripts/dossier-df-bootstrap-worktrees.sh --teardown     # removes them (branches kept)
#
# Idempotent: skips lanes whose worktree path already exists.

set -eu

BASE="/Users/emilionunezgarcia"
REPO="$BASE/Job-Bored"
PARENT_BRANCH="feat/flowing-page"

# lane name | worktree dir suffix | branch name
LANES=(
  "ats-state-bus|ats-bus|dossier-df/ats-state-bus"
  "writeback-bridge|writeback|dossier-df/writeback-bridge"
  "css|css|dossier-df/css"
  "brief|brief|dossier-df/brief"
  "workshop|workshop|dossier-df/workshop"
  "integration|integration|dossier-df/integration"
  "tests-screens|qa|dossier-df/tests-screens"
)

worktree_path_for() {
  local suffix="$1"
  echo "$BASE/Job-Bored-wt-dossier-df-$suffix"
}

verify_clean_parent() {
  cd "$REPO"
  local current
  current="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$current" != "$PARENT_BRANCH" ]; then
    echo "WARN: repo HEAD is on '$current', expected '$PARENT_BRANCH'." >&2
    echo "      Worktrees will branch off '$PARENT_BRANCH' regardless." >&2
  fi
  # Make sure feat/flowing-page itself exists locally.
  if ! git rev-parse --verify --quiet "$PARENT_BRANCH" >/dev/null; then
    echo "ERROR: parent branch '$PARENT_BRANCH' does not exist locally." >&2
    exit 2
  fi
}

dry_run() {
  echo "── Bootstrap (dry-run) ── parent: $PARENT_BRANCH"
  for row in "${LANES[@]}"; do
    local lane="${row%%|*}"
    local rest="${row#*|}"
    local suffix="${rest%%|*}"
    local branch="${rest##*|}"
    local wt
    wt="$(worktree_path_for "$suffix")"
    if [ -d "$wt" ]; then
      echo "[$lane] SKIP (exists): $wt"
    else
      echo "[$lane] git -C $REPO worktree add $wt -b $branch $PARENT_BRANCH"
    fi
  done
}

run_bootstrap() {
  verify_clean_parent
  echo "── Bootstrap ── parent: $PARENT_BRANCH"
  local created=0 skipped=0
  for row in "${LANES[@]}"; do
    local lane="${row%%|*}"
    local rest="${row#*|}"
    local suffix="${rest%%|*}"
    local branch="${rest##*|}"
    local wt
    wt="$(worktree_path_for "$suffix")"

    if [ -d "$wt" ]; then
      echo "[$lane] SKIP (exists): $wt"
      skipped=$((skipped + 1))
      continue
    fi

    # If the branch already exists, attach the worktree to it instead of -b.
    if git -C "$REPO" rev-parse --verify --quiet "$branch" >/dev/null; then
      echo "[$lane] reusing existing branch $branch -> $wt"
      git -C "$REPO" worktree add "$wt" "$branch"
    else
      echo "[$lane] new branch $branch off $PARENT_BRANCH -> $wt"
      git -C "$REPO" worktree add "$wt" -b "$branch" "$PARENT_BRANCH"
    fi
    created=$((created + 1))
  done
  echo
  echo "Done. created=$created skipped=$skipped"
  echo "Worktrees:"
  git -C "$REPO" worktree list | grep "Job-Bored-wt-dossier-df-" || true
}

run_teardown() {
  echo "── Teardown ── removing worktrees (branches kept)"
  for row in "${LANES[@]}"; do
    local lane="${row%%|*}"
    local rest="${row#*|}"
    local suffix="${rest%%|*}"
    local wt
    wt="$(worktree_path_for "$suffix")"
    if [ -d "$wt" ]; then
      echo "[$lane] removing $wt"
      git -C "$REPO" worktree remove "$wt" --force
    else
      echo "[$lane] SKIP (missing): $wt"
    fi
  done
  git -C "$REPO" worktree prune
}

case "${1:-}" in
  --run)       run_bootstrap ;;
  --teardown)  run_teardown ;;
  "" | --dry-run) dry_run ;;
  *) echo "usage: $0 [--dry-run] | --run | --teardown" >&2; exit 2 ;;
esac
