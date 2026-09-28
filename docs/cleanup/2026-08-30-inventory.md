# Cleanup inventory — 2026-08-30 (post ship-log swarm)

Evidence basis: `git cherry main <branch>` (patch-equivalence; this repo rebase-merges, so SHA-based `--merged` is blind), per-worktree `git status --porcelain`, cmux pane liveness, `lsof` cwd scan.

## ACTIVE — untouchable

| Item | Evidence |
| --- | --- |
| `~/Job-Bored` (main) | primary checkout, serves :8080 |
| `~/repos/jobbored/oss-redesign` + `feat/oss-packaged-redesign` | dirty=8; discovery keepalive launchd infra points here (memory: do NOT delete) |

## Tonight's swarm — DONE (proposed sweep, category A)

All five branches: **0 unique commits vs main** (fully landed as PRs #68–#72).

- cmux workspaces 26, 27, 28, 32, 33, 43 (`sol:*`) — all lane processes exited 0
- Worktrees `~/jb-lanes/{journey-e2e,run-durability,server-strict-types}` — dirty only by the intentionally-uncommitted `.lane-report.md` (archived to `~/jb-lanes-archive-2026-08-30/` before removal)
- Local+remote branches: `feat/journey-e2e`, `feat/discovery-run-durability`, `refactor/server-strict-types`, `chore/ci-hygiene`, `fix-multi-query-prose-recovery`; stale `origin/pr-65-head`, `origin/pr-66-head`
- Scratch: `~/jb-lanes/prompts/`, `~/jb-lanes/state/` (archived with the reports)
- Preservation: `git tag zz-archive/shiplog-20260830/<name> <branch>` before every deletion

## Older landed branches — DONE (proposed sweep, category B)

Each verified **0 unique commits vs main**; remotes already deleted (`[gone]`):
`chore/ci-hardening`, `chore/oss-launch-hygiene`, `feat/discovery-gate-and-enhancements`, `feat/onboarding-hardening-followups`, `feat/onboarding-setup-surface-polish`, `feat/quality-sweep`, `feat/signpost-provider-split`, `feat/wizard-delight-pass`, `test/e2e-browser-smoke`, `test/untested-core-modules`, `feat/mandatory-onboarding-setup` (verified 0 unique despite "ahead 8" — patches landed via rebase).
Candidates pending a cherry check at execution (skip any with unique commits): 3 local `dependabot/*` `[gone]`, `codex/pr65-audit-fix`, `codex/pr66-review`.
Same tag-first preservation (`zz-archive/landed/<name>`).

## June 16 swarm — UNKNOWN (category C, needs owner call)

6 worktrees under `~/repos/jobbored/cmux-swarm/` (all clean, untouched since June) + `cmux/*` branches. `be-impl` and `fe-impl` each hold **1 unlanded commit** (worker health/CORS pin; wizard verify 401 fix). Worktree removal loses nothing (clean trees, branches keep the commits); the two unlanded branches stay regardless.

## openrouter-compat — UNKNOWN (category D, needs owner call)

18 local branches, no remotes; `integration` tip says "record main merge verification", suggesting the program landed. Not verified yet.

## Always-keep UNKNOWNs (no action, reported only)

- 8 stashes (incl. `stash@{0}` "preserve unrelated resilience and dogfood work" from tonight's premerge, and 6 from `refactor/app-js-decompose`) — stashes are saved work by definition; offer: convert any to `recovered/<name>` branches on request
- `/private/tmp/Job-Bored-onboarding-e2e` (`test/greenfield-onboarding-e2e`): dirty=1 AND 1 unique commit — live-looking, kept
- `docs/discovery-gate-and-enhancements-specs`, `openrouter-compat` docs branches — program docs, kept pending D

## Result — executed 2026-08-30 ~22:25

Removed (every branch tagged before deletion; undo: `git branch <name> zz-archive/...` / `git worktree add <path> <tag>`):
- 6 sol:* cmux workspaces; 3 ~/jb-lanes worktrees; ~/jb-lanes scratch (archived first to ~/jb-lanes-archive-2026-08-30/)
- 6 June-swarm worktrees (clean; branches kept + tagged)
- 43 local branches: 5 shiplog, 11 old landed, 3 stale dependabot, 18 openrouter-compat (all cherry-verified 0 unique), 1 docs branch
- 10 remote branches (merged PR heads, pr-65/66-head, stale dependabot)

Kept, with evidence:
- ACTIVE: main; oss-redesign worktree (dirty=8, keepalive infra)
- UNKNOWN: /private/tmp/Job-Bored-onboarding-e2e (dirty + 1 unique commit); codex/pr65-audit-fix and codex/pr66-review (1 unique commit each); 6 cmux/* June branches (be-impl/fe-impl hold 1 unlanded commit each); all 8 stashes; release-please branch (live automation)

Final counts: 3 worktrees, 11 local branches, 2 remote branches, 8 stashes, ~48 zz-archive tags.
