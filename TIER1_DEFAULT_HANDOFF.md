# Tier 1 Default Flip — Handoff

**Branch:** `feat/tier1-default-on` (base: `feat/layer5-integration`)
**Status:** complete, awaiting orchestrator review before commit.

## Step 1 — Investigation

**Finding: no safety reason. Conservative default only. Safe to flip.**

`git log --follow -p settings-profile-tab.js` shows `enabled: false` was
introduced in commit `f3b3339 feat(layer5): in-UI auto-refresh toggle +
daily-refresh status panel` as the initial fallback in
`readAutoRefreshState()`. The commit message frames Tier 1 as a "zero-infra
cadence path" — purely additive functionality with no documented rationale
for keeping it off by default; it reads like the usual conservative
opt-in choice for a new feature.

The only follow-up touch was `7d72dbb feat(schedule-ui): add Settings
Schedule card with three-tier ladder`, whose message explicitly says Tier
1 was "re-labelled and re-parented into the card; no behavior change." So
`enabled: false` has never been defended as a safety gate — the worker,
debouncer, and `runInFlight` guard in `scheduleAutoRefresh()` are
independently robust, and Tier 1 simply reuses the same `handleRefresh()`
that the manual Discover button fires.

No test, PR description, or linked issue locks the old default in place.
Proceeding with Step 2.

## Step 2 — What changed

**`settings-profile-tab.js`** (two tiny edits):

1. `readAutoRefreshState()` fallback flipped from `enabled: false` →
   `enabled: true`, with a comment explaining why the flip is safe for
   existing users (the fallback only fires when
   `AUTO_REFRESH_STORAGE_KEY` has no record — any user who explicitly
   chose off, or who ever touched cadence, has a persisted record that
   survives unchanged).
2. Exposed `readAutoRefreshState` / `writeAutoRefreshState` / the storage
   key / `VALID_HOURS` on
   `window.JobBoredSettingsProfileTab.autoRefresh` so the vm-sandboxed
   test harness can reach them. This mirrors the existing
   `.schedule` namespace and adds no runtime behavior.

Copy review: `updateAutoRefreshHint()` was left untouched. The
on-state message ("Enabled. Next fire around HH:MM. Closing this tab
pauses the schedule.") reads correctly as a new-user message, and the
off-state message ("Zero-infra cadence. Runs in this browser tab only;
closing the tab pauses the schedule.") still reads fine after a user
switches Tier 1 off.

## Step 3 — Tests

Added a new `describe("Schedule card — Tier 1 (auto-refresh) default", …)`
block to `tests/settings-profile-schedule-card.test.mjs` with three
cases:

- Fresh localStorage → `readAutoRefreshState()` returns
  `{ enabled: true, intervalHours: 12, lastFiredAt: 0 }`.
- Existing record with `enabled: false` → preserved (new default does
  not override explicit user choice).
- Malformed JSON in the storage key → falls back to `enabled: true`
  (parity with the happy-path fallback).

No existing test asserted the old `enabled: false` default for
auto-refresh — the other `enabled: false` references in
`tests/settings-profile-schedule-card.test.mjs` and
`tests/integration/schedule-e2e.test.ts` are all for Tier 2 / Tier 3
schedules, which intentionally stay opt-in.

## Test output

```
env -u NODE_OPTIONS node --test tests/settings-profile-schedule-card.test.mjs

▶ Schedule card — Tier 1 (auto-refresh) default
  ✔ readAutoRefreshState returns enabled:true when localStorage has no record
  ✔ readAutoRefreshState preserves explicit enabled:false from storage
  ✔ readAutoRefreshState falls back to enabled:true on malformed JSON
✔ Schedule card — Tier 1 (auto-refresh) default

ℹ tests 32
ℹ suites 6
ℹ pass 32
ℹ fail 0
```

All 32 tests pass, including the 3 new ones.

## Gotchas / notes for orchestrator

- **Users who changed cadence but not the toggle won't auto-enable.**
  `handleAutoRefreshCadenceChange()` calls `writeAutoRefreshState({
  intervalHours })`, which `Object.assign`s onto the previously-read
  state and persists it. Pre-flip, any cadence change wrote
  `enabled: false` into the record. Those users keep Tier 1 off. This
  is consistent with the brief's spirit ("respect existing choice if
  they've touched the Schedule card").
- **No backend or worker change.** Tier 2/3 paths untouched.
- **Diff footprint:** 2 files, +41/-1 lines.
- **No commits made.** Per global rules, awaiting orchestrator approval.

## Self-gate

- [x] `env -u NODE_OPTIONS node --test tests/settings-profile-schedule-card.test.mjs` → 32/32 pass.
- [x] No other test files touched.
- [ ] Manual browser verification: **not performed in this worktree
      (headless environment).** Recommended: open dashboard in a fresh
      private window, confirm Tier 1 toggle renders checked; flip off,
      reload → stays off; clear localStorage, reload → back to checked.
