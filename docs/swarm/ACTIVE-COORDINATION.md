# Active Coordination Board

Updated: 2026-05-07T00:47:27Z
Coordinator: Codex overseer session in `/Users/emilionunezgarcia/Job-Bored`

## Current Hold

All active Job-Bored agents should pause implementation work until the coordinator clears the next lane.

Do not commit, merge, rebase, reset, delete files, push, or edit `.env`, state DB, log, or upload files while this hold is active.

Latest coordinator outcome:

- Fresh branch `feat/settings-profile-consolidation` was created from `origin/main`.
- Commit `0e03c5f feat: consolidate discovery targeting in profile settings` was pushed.
- PR #5 was squash-merged into `origin/main` as `9bf44f3 Consolidate discovery targeting in profile settings`.
- GitHub post-merge `contract` and Pages deployment checks passed on `main`.
- Clean next-lane worktree created at `/private/tmp/job-bored-onboarding-resume-upload` on branch `feat/onboarding-resume-upload-repair`.
- Next worker brief: `docs/swarm/NEXT-WORKER-ONBOARDING-RESUME.md`.
- Onboarding/resume-upload verification completed with no product changes needed.
- Report: `/private/tmp/job-bored-onboarding-resume-upload/ONBOARDING_RESUME_WORKER_REPORT.md`.
- Screenshot: `/tmp/jobbored-onboarding-resume-smoke.png`.
- PR #1 (`feat/companies-in-run-discovery`) was closed as superseded by PR #4.
- Remote `feat/settings-profile-consolidation` was deleted after PR #5 merged.
- PR #2 (`redesign/integration`) remains the only open PR and is the next redesign reference lane.
- Do not resume stale greenfield/company/settings/onboarding branches. Current verified result is clean; next implementation lane should be selected deliberately from the dashboard/kanban redesign roadmap, not from stale worktree momentum.

## Verified Remote Truth

- `origin/main` is at `9bf44f3e788fc4cfcd7f1abd92d1e7481221782a`.
- Latest visible main commit: `9bf44f3 Consolidate discovery targeting in profile settings`.
- PR #1 is closed as superseded. Remote `feat/companies-in-run-discovery` still exists at `adaa8e47e2d2c50360050368d4d05a2ecf1a8566`; keep it for archival/reference only.
- PR #2 (`redesign/integration`) is open and currently conflicting with `main`; treat it as redesign reference/port material, not a direct merge source.

## Live Local Processes

Confirmed at coordination start:

| TTY | Role | CWD | Notes |
| --- | --- | --- | --- |
| `ttys003` | dev stack | `/Users/emilionunezgarcia/Job-Bored` | `npm run dev`, dashboard, worker, scraper |
| `ttys004` | droid | `/Users/emilionunezgarcia/Job-Bored` | active Job-Bored agent |
| `ttys007` | codex | `/Users/emilionunezgarcia/Job-Bored` | coordinator session |
| `ttys009` | droid | `/Users/emilionunezgarcia/Job-Bored` | active Job-Bored agent |
| `ttys011` | ngrok | `/Users/emilionunezgarcia/Job-Bored` | tunnel for worker |
| `ttys013` | claude | `/Users/emilionunezgarcia/Job-Bored` | process cwd is Job-Bored, but current Claude Desktop log appears unrelated to Job-Bored; do not interrupt unless user confirms |

Also observed: a separate `droid` on `ttys002` in `/Users/emilionunezgarcia/elio-intelligence-suite`; leave it alone.

Recent Factory session logs that look relevant:

| Session | Updated | Current topic |
| --- | --- | --- |
| `a025d12e-bc09-4e3f-a169-d30ccc5a91e2` | 2026-05-06 17:55 CT | Discovery settings are fragmented; proposed settings/profile cleanup plus matcher tightening |
| `3e0faf6d-d1fb-43de-9cfa-e128444f9a13` | 2026-05-06 17:49 CT | Onboarding/resume upload failure and settings architecture review |
| `d6629db5-78e2-4002-b96e-b7232eab0488` | 2026-05-06 16:21 CT | Greenfield automation frontend worker handoff; appears completed |

The first two sessions may both touch `index.html`, `app.js`, `settings-profile-tab.js`, and settings/onboarding UI. They must not edit in parallel.

## Tooling Reality

- cmux app process is running, but `cmux ping` and workspace commands currently fail with `Failed to write to socket (Broken pipe, errno 32)`.
- Warp is blocked from Computer Use desktop automation in this environment.
- Coordination is therefore happening through repo-local board files, process inventory, and any agent-native session hooks that are safe to use.

Do not restart cmux, Warp, or agent terminals without explicit user approval.

## Worktree Snapshot

Important worktrees and risk notes:

| Path | Branch | Status |
| --- | --- | --- |
| `/Users/emilionunezgarcia/Job-Bored` | `feat/greenfield-automation-swarm` | upstream gone, dirty local `.env` plus untracked assets/docs/uploads |
| `/Users/emilionunezgarcia/Job-Bored-wt-runs-polish` | `main` | behind `origin/main` by 2 and heavily dirty |
| `/Users/emilionunezgarcia/Job-Bored-wt-companies-run` | `feat/companies-in-run-discovery` | clean, remote branch still exists, likely superseded by PR #4 |
| `/Users/emilionunezgarcia/Job-Bored-wt-companies-run-backend` | `feat/companies-run-backend` | clean |
| `/Users/emilionunezgarcia/Job-Bored-wt-companies-run-frontend` | `feat/companies-run-frontend` | clean |

There are prunable `/private/tmp/job-bored-*` worktrees. Do not prune them during the hold unless the coordinator or user explicitly asks.

## Required Agent Reply

Each active Job-Bored agent should report only this, then wait:

```text
COORDINATION REPORT
cwd:
branch:
git status --short:
current objective:
files changed by me:
local-only files touched (.env/state/log/uploads):
blockers:
```

## Current Direction

Clean-main smoke status:

- Clean detached worktree created at `/private/tmp/job-bored-clean-main-20260506T2302Z`.
- HEAD: `40e6baf Bring company picker into Run Discovery (#4)`.
- `npm ci` completed successfully.
- `npm run typecheck:repo` completed successfully.
- `npm test -- tests/runs-tab.test.mjs` passed: 27 tests, 0 failures.
- Static dashboard smoke ran on `http://127.0.0.1:18080/` through browser-use.
- Browser reached the Google connect gate, dashboard shell existed, settings modal existed, 26 scripts were present.
- Server logs showed project scripts returned 200. `config.js` returned 404, which is expected for this static app when local overrides are used.
- Smoke server and browser session were stopped after verification.

The clean path from here is now:

1. Collect active agent coordination reports.
2. Treat the company picker branch family as already landed unless a focused diff proves missing behavior.
3. Triage the dirty greenfield and runs-polish worktrees separately; do not merge them as a bundle.
4. Pick exactly one browser-UI lane next: either settings/profile consolidation or onboarding/resume upload repair. Do not run both at once.
5. If implementation continues, start from the clean worktree or a fresh branch off `origin/main`, not the dirty root.

## Broadcast Message

Paste this into any active agent that is still working:

```text
COORDINATOR MESSAGE - Job-Bored hold point

Pause implementation now. Do not commit, merge, rebase, reset, delete files, push, or edit .env/state/log/uploads until cleared.

Current remote truth: origin/main = 40e6bafb51fe34751c42b335df9564a47c385a0d, latest commit "Bring company picker into Run Discovery (#4)".

If you are on any feat/companies-* branch, assume your branch may be stale or superseded. Do not continue it blindly.

Reply with:
1. cwd
2. branch
3. git status --short
4. current objective
5. files changed by you
6. any local-only files touched (.env/state/log/uploads)

Then wait for coordinator clearance.
```
