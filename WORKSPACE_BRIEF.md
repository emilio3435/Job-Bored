# Workspace Brief — `tier1-default-on`

**Role:** small-scope investigation + fix agent (Claude Opus 4.7, 1M context) in a cmux swarm.
**Branch:** `feat/tier1-default-on` (already checked out in this worktree).
**Base:** `feat/layer5-integration`.

## The job

The Tier 1 "auto-refresh while this tab is open" toggle in Settings → Profile → Schedule defaults to **off**. A fresh OSS user should get passive discovery cadence for free, so the default should flip to **on** (at the existing default interval of 12h, which is already the configured default in `AUTO_REFRESH_VALID_HOURS`).

## Step 1 — investigate

Before changing anything, figure out *why* it was off by default. Use `git log -p --follow settings-profile-tab.js` / `git blame` around the `AUTO_REFRESH_STORAGE_KEY` / `readAutoRefreshState` functions (lines ~694-724) and the `fallback = { enabled: false, ... }` in particular. Look for:

- A commit message or PR description explaining the choice.
- A test that locks the off default in place.
- A linked issue / discussion.

Write a paragraph in `TIER1_DEFAULT_HANDOFF.md` summarizing what you found. If you find a real safety reason (e.g. "this was off because the worker wasn't always running and firing with no worker crashed the UI"), stop and ping the orchestrator before flipping — we need to revisit.

If the answer is "no particular reason, just a conservative default," proceed to step 2.

## Step 2 — flip the default

Minimum-change patch:

- In `settings-profile-tab.js`, the `fallback` constant inside `readAutoRefreshState()` changes its `enabled` field from `false` to `true`.
- **But only apply the new default when the user has NEVER opened the Schedule card** — if they've touched it before and chose off, respect that. The localStorage key `AUTO_REFRESH_STORAGE_KEY` already distinguishes "no record" vs "record with enabled:false." The fallback only fires when there's no record, so changing the fallback is exactly correct — it gives new users on by default while preserving existing users' explicit choices.
- Update `updateAutoRefreshHint()` copy if "Zero-infra cadence. Runs in this browser tab only; closing the tab pauses the schedule." would feel odd as an on-by-default message. Probably fine, but read it and judge.

## Step 3 — update tests

Search `tests/` for anything asserting the old `enabled: false` default. Update those assertions. Add one new test verifying: "a fresh localStorage returns `enabled:true` from `readAutoRefreshState`."

## What you DO NOT touch

- Anything outside `settings-profile-tab.js` + its tests unless necessary for #3.
- The Tier 2 or Tier 3 code paths.
- The worker, scripts, installers — this is purely a frontend default change.

## Self-gate

1. `env -u NODE_OPTIONS node --test tests/settings-profile-schedule-card.test.mjs` passes.
2. Any other test files touched: pass.
3. Manual: open the dashboard in a fresh private-window (no localStorage yet), go to Settings → Profile → Schedule → Tier 1 toggle should render checked. Switch it off, reload, still off (existing choice preserved). Clear localStorage, reload, back to on.

## Reporting back

`TIER1_DEFAULT_HANDOFF.md` in worktree root with:
- Investigation writeup (step 1 findings).
- What you changed.
- Test output.
- Any gotchas.

## Global rules

`~/.claude/CLAUDE.md`, `~/.claude/rules/code-style.md`, `~/.claude/rules/testing.md`. **No commits without orchestrator approval** — local commits on this branch are fine.

Go.
