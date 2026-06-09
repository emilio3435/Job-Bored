# Mandatory two-track onboarding — design

**Date:** 2026-06-08
**Status:** Approved (brainstorming) → ready for implementation plan

## The "so what"

Today a new user finishes one setup track ("Set up job discovery" **or** "Use
JobBored on other devices") and nothing carries them into the other. The
existing cross-recommendation is a soft banner nudge that's easy to miss. Make
**completing both tracks a guided, required part of onboarding** — strongly
mandatory-feeling, but never a hard wall that traps a user when a track can't
finish (e.g. discovery's grounded-search key is expired).

## Decisions (locked in brainstorming)

- **Enforcement:** *guide hard, don't trap.* Auto-open the next track + a
  persistent progress bar, but the user can always reach the dashboard.
- **Order:** **Discovery first → auto-chain to go-live.** Either order is still
  supported under the hood (finishing go-live first chains to discovery).
- **Progress bar escape:** a small, low-emphasis **"Later"** control that
  snoozes the bar for the **current session only** (reappears on reload/next
  session until both tracks are complete). NOT the permanent dismiss.
- **"Complete" = setup connected, not run success.** `isDiscoverySetupComplete`
  is set when the discovery wizard verifies its connection, independent of
  whether a later discovery *run* finds leads. So an expired search key cannot
  block finishing setup.

## Current flow

1. Login gate → sign in.
2. First-run wizard: Step 1 Sheet → Step 2 Provider.
3. On done: optional buttons (`firstRunDoneOpenDiscovery` /
   `firstRunDoneOpenSelfHosting`) or straight to dashboard.
4. What's-next banner: after onboarding + infra complete, softly
   cross-recommends the other track (completion-aware; hides when both done).

## New flow

1. Login gate → sign in. *(unchanged)*
2. First-run wizard: Sheet → Provider. *(unchanged steps)*
3. On first-run completion → **auto-launch Discovery setup**
   (`requestGoLiveSetup`'s sibling `requestDiscoverySetup`, with the existing
   onboarding-defer gate honored).
4. When Discovery setup finishes (`reason === "finish"`, flag set) and go-live
   is incomplete → **auto-open the go-live wizard** (`requestGoLiveSetup`).
5. When go-live finishes → both flags set → nothing auto-fires.
6. Throughout steps 3–5, a **"Finish setup — X of 2" progress bar** is shown
   (the upgraded what's-next banner). It is non-dismissible **except** the
   session-scoped "Later" snooze. It hides permanently once both flags are set.

## Behavior details

### Auto-launch + chain
- `first-run-wizard.js`: the done handler routes into Discovery setup
  unconditionally (mirror today's dashboard handoff, then
  `requestDiscoverySetup({ entryPoint: "onboarding", allowWhileOnboarding: true })`).
- `discovery-wizard-ui.js`: `recommendGoLiveAfterDiscoveryFinish` is upgraded
  from "refresh the banner" to **launch `requestGoLiveSetup`** when discovery
  finishes connected and go-live is incomplete (falling back to a banner
  refresh if the bridge is unavailable, as today).
- `go-live-wizard-ui.js`: symmetric — its done step already cross-recommends
  discovery; ensure that when go-live finishes and discovery is incomplete it
  **launches `requestDiscoverySetup`** (not just a nudge), so either order
  chains.

### Progress bar (`whats-next-banner.js`)
- Reads the two flags via the existing `readGateState`.
- Renders a setup-progress affordance: **"Finish setup — N of 2 complete"** with
  the remaining track(s) as the prominent CTA(s) (reuse
  `applyCompletionPresentation`'s recommended-CTA treatment).
- **Non-dismissible** while either flag is unset, EXCEPT a small **"Later"**
  control that writes a **session-scoped** snooze (e.g. `sessionStorage`), which
  suppresses the bar until reload/next session. While setup is incomplete the
  bar offers ONLY this session "Later"; the permanent `whatsNextDismissed`
  dismiss is not offered until both tracks are complete.
- Hides entirely when both flags are set (today's behavior).

### Completion semantics (unchanged, reaffirmed)
- `isDiscoverySetupComplete` ← discovery wizard onClose with `reason==="finish"`
  and a connected result.
- `isGoLiveSetupComplete` ← go-live wizard done step.

## Edge cases

- **User closes an auto-opened wizard:** bar persists with a "Resume
  <track>" CTA. Dashboard is usable (not trapped).
- **"Later" pressed:** bar hidden for the session; returns on reload until both
  done.
- **Returning user, both flags set:** no bar, no auto-open (idempotent).
- **Discovery can't connect (worker down / key issue):** user can close, reach
  the dashboard; bar stays. Not trapped.
- **One track completed in a prior session:** bar shows "1 of 2"; auto-open
  fires for the remaining track on next relevant trigger (not aggressively on
  every dashboard load — only chained from finishing the other, or via the CTA).

## Components touched

| File | Change |
|------|--------|
| `first-run-wizard.js` | Done handler auto-launches Discovery setup |
| `discovery-wizard-ui.js` | On finish, auto-open go-live (upgrade from banner nudge) |
| `go-live-wizard-ui.js` | On finish, auto-open discovery if incomplete (symmetry) |
| `whats-next-banner.js` | Setup-progress bar: "X of 2", non-dismissible + session "Later" |
| `user-content-store.js` | (reuse existing flags; add session-snooze helpers if needed) |

## Testing

- `tests/whats-next-signpost.test.mjs` / `tests/go-live-cross-rec.test.mjs`
  (extend): first-run done auto-launches discovery; discovery finish auto-opens
  go-live; go-live finish auto-opens discovery when incomplete; bar shows
  "N of 2"; bar non-dismissible except "Later" (session snooze); both-done hides.
- `node --check` on all changed files; full `npm test` (incl. integration).

## Out of scope

- The expired discovery search key (separate config fix, user-owned).
- Redesigning the discovery or go-live wizard internals (only their finish
  handoffs change).
- Changing the post-setup banner's normal dismiss behavior once both tracks are
  complete.
