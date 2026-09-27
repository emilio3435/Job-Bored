# Worktree sweep — 2026-09-25 21:20 CDT (orchestrator ws:66, approved by Emilio)

## DONE — removed (clean, branch fully in origin/main, no process cwd; branches kept)
- casefit-F1 → `feat/casefit-F1` — undo: `git worktree add ~/Job-Bored.worktrees/casefit-F1 feat/casefit-F1`
- casefit-integration → `feat/casefit` — undo: `git worktree add ~/Job-Bored.worktrees/casefit-integration feat/casefit`
- casefit-M2 → `feat/casefit-M2` — undo: `git worktree add ~/Job-Bored.worktrees/casefit-M2 feat/casefit-M2`
- casefit-S3 → `feat/casefit-S3` — undo: `git worktree add ~/Job-Bored.worktrees/casefit-S3 feat/casefit-S3`
- casefit-T4 → `feat/casefit-T4` — undo: `git worktree add ~/Job-Bored.worktrees/casefit-T4 feat/casefit-T4`
- greenfield-integration → `feat/greenfield-integration` — undo: `git worktree add ~/Job-Bored.worktrees/greenfield-integration feat/greenfield-integration`
- pr107 → `fix/pr107-work` — undo: `git worktree add ~/Job-Bored.worktrees/pr107 fix/pr107-work`
- pr110 → `cursor/allowlist-empty-catalog-seeds-29e7` — undo: `git worktree add ~/Job-Bored.worktrees/pr110 cursor/allowlist-empty-catalog-seeds-29e7`
- scribe-empty-draft → `bringup/pr112` — undo: `git worktree add ~/Job-Bored.worktrees/scribe-empty-draft bringup/pr112`
- ux01-board-apply → `feat/ux01-board-apply` — undo: `git worktree add ~/Job-Bored.worktrees/ux01-board-apply feat/ux01-board-apply`
- ux01-cleanup-board → `feat/ux01-cleanup-board` — undo: `git worktree add ~/Job-Bored.worktrees/ux01-cleanup-board feat/ux01-cleanup-board`
- ux01-cleanup-shell → `feat/ux01-cleanup-shell` — undo: `git worktree add ~/Job-Bored.worktrees/ux01-cleanup-shell feat/ux01-cleanup-shell`
- ux01-cleanup-system → `feat/ux01-cleanup-system` — undo: `git worktree add ~/Job-Bored.worktrees/ux01-cleanup-system feat/ux01-cleanup-system`
- ux01-dossier-tailor → `feat/ux01-dossier-tailor` — undo: `git worktree add ~/Job-Bored.worktrees/ux01-dossier-tailor feat/ux01-dossier-tailor`
- ux01-entry-find → `feat/ux01-entry-find` — undo: `git worktree add ~/Job-Bored.worktrees/ux01-entry-find feat/ux01-entry-find`
- ux01-shell-today → `feat/ux01-shell-today` — undo: `git worktree add ~/Job-Bored.worktrees/ux01-shell-today feat/ux01-shell-today`
- ux01-sol-server → `feat/ux01-sol-server` — undo: `git worktree add ~/Job-Bored.worktrees/ux01-sol-server feat/ux01-sol-server`
- ux01-system → `feat/ux01-system` — undo: `git worktree add ~/Job-Bored.worktrees/ux01-system feat/ux01-system`
- ux01-train-b → `feat/ux01-train-b` — undo: `git worktree add ~/Job-Bored.worktrees/ux01-train-b feat/ux01-train-b`
- ux01-train-e → `feat/ux01-train-e` — undo: `git worktree add ~/Job-Bored.worktrees/ux01-train-e feat/ux01-train-e`
- ux01-train → `feat/ux01-train` — undo: `git worktree add ~/Job-Bored.worktrees/ux01-train feat/ux01-train`
- ux01-up-102 → `feat/discovery-hardening` — undo: `git worktree add ~/Job-Bored.worktrees/ux01-up-102 feat/discovery-hardening`

## ACTIVE — kept
- bbuild-feat-beaudit-build-w1b, bbuild-s, bbuild-l, bbuild-y — wave 1b run wf_3a1995bb-572 live (processes in cwd; bbuild-l dirty)
- beaudit-integration — dirty=1, 5 unpushed program-doc commits
- ux01 — :8644 discovery worker pid 18106 + cloudflared run from it; removal pending worker restart from ~/Job-Bored

## UNKNOWN — kept
- ux01-states-settings — dirty=1
- .worktrees/feat-standalone-materials-drafter — dirty=1
- main-bringup (bringup/pr117-materials) — not in main; #117 CLOSED; commits exist on other refs
- pr105 (fix/pr105-deps) — #105 still open
- 9 stashes (stash@{0..8}) — never dropped

## Follow-up 21:25 CDT
- :8644 worker restarted from ~/Job-Bored (main beaaf91d), pid 53719, /health ready. Orphan cloudflared 18353/55319 stopped.
- ux01 (feat/ux-zero-to-one) removed — undo: `git worktree add ~/Job-Bored.worktrees/ux01 feat/ux-zero-to-one`
- Main checkout moved fix/beat1-greenfield-gis-init → main. 21 untracked files that main now tracks moved to .agent/runs/preserved-untracked-20260925/ (20 identical to main; GREENFIELD-SPEC.md differs — your local edits).
