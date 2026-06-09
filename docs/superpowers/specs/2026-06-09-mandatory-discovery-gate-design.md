# Mandatory discovery setup gate — design

**Date:** 2026-06-09
**Status:** Approved (brainstorming) → ready for implementation plan

## The "so what"

Discovery setup is the engine of the whole app — without it there are no leads.
Today it is **invisible**: it auto-launches via a soft, fire-and-forget chain
that can silently short-circuit, so a new user can land on the dashboard having
never seen (or knowingly completed) discovery setup. The product owner
experienced exactly this: they saw sheet/OAuth → resume/persona → multi-device,
but discovery "was missing." Make discovery a **hard, unmissable, mandatory
step** in the sequence, positioned **after resume/persona and before
multi-device** — without rewriting the proven discovery wizard.

## Why it looks "missing" today (root cause)

The discovery wizard (`discovery-wizard-ui.js`, ~3,100 lines) is fully built and
auto-launches, but it can complete or skip **without ever rendering**:

1. **Autodetect silent-complete (localhost).** `openDiscoverySetupWizard`
   (`discovery-wizard-ui.js:2168`) runs `JobBoredDiscoveryAutodetect
   .recoverIfPossible()` first. If the local stack is healthy it shows a toast
   ("Discovery is already set up."), **persists `discoverySetupComplete`, and
   returns without rendering** (`~:2206`). The chain then auto-opens go-live — so
   the user sees multi-device but never discovery. This is the primary cause in
   local/greenfield dogfooding.
2. **Deferral.** `requestDiscoverySetup` returns `{ deferred: true }` and queues
   a `sessionStorage` pending flag when a wizard is visible and the caller did
   not pass `allowWhileOnboarding: true` (`discovery-status-handoff.js:448`).
3. **Already-complete guard.** `advanceToDiscoveryAfterOnboarding`
   (`onboarding-wizard.js`) skips opening when `isDiscoverySetupComplete()` is
   already true.

These are intentional guards, but combined they let discovery be marked done
silently. The fix is to make discovery a **visible, required gate**, not a soft
nudge — and to disable the silent toast-and-return path for the onboarding
entry point.

## Decisions (locked in brainstorming)

- **Approach: sequenced mandatory gate, NOT fold-in.** Keep the discovery
  wizard exactly as-is internally (it's large, shell-rendered, and proven).
  Wrap it in a hard gate. (Folding it into the bespoke resume/persona step rail
  was rejected: ~3,100 lines, 11 step ids, 3 flows, ~40 host methods, a visual
  redesign, and high regression risk.)
- **Position:** the canonical mandatory sequence becomes
  **sheet/OAuth → resume/persona → DISCOVERY → multi-device (go-live)**.
  Discovery sits after the profile (it needs the profile's target roles to
  search well) and before go-live.
- **Hard gate with a safety valve.** The user cannot proceed to a usable
  dashboard until `isDiscoverySetupComplete` is true, EXCEPT a clearly-secondary,
  **confirm-gated "I can't set this up right now — finish later from Settings"**
  escape. This avoids trapping a user whose worker is down or whose
  grounded-search key is expired (consistent with the existing "honest
  run-health" surface and the no-hard-trap stance elsewhere).
- **Always visible during onboarding.** When discovery is opened from the
  onboarding gate it must present a visible surface — the setup wizard when not
  connected, or a brief **"Discovery is connected ✓"** confirmation step when
  autodetect finds it already healthy. The silent toast-and-return is disabled
  for the onboarding entry point.

## New flow

1. Sheet/OAuth gate → sign in. *(unchanged)*
2. First-run wizard: sheet → provider. *(unchanged)*
3. Resume/persona onboarding wizard → finish → celebration. *(unchanged; the
   celebration's "next step" handoff now targets the discovery gate.)*
4. **Discovery gate (NEW, mandatory):** the discovery setup wizard opens as a
   required full-screen step.
   - Connected/finished → `discoverySetupComplete` set → proceed to go-live.
   - Closed without completing AND not skipped → the gate re-asserts: a blocking
     "Discovery is required to find jobs" panel with **[Set up discovery]**
     (primary, re-opens the wizard) and the small confirm-gated escape.
   - Escape confirmed → write `discoverySetupSkipped` (or a `deferredAt`
     timestamp) → user reaches the dashboard; the "Finish setup" card keeps the
     discovery row nudging until it's actually done.
5. Multi-device (go-live) → done. *(unchanged; still cross-recommends/auto-opens
   the other track per the two-track feature.)*

## Behavior details

- **Gate location.** The hard gate is enforced at the **onboarding-finish →
  discovery transition** (`onboarding-wizard.js advanceToDiscoveryAfterOnboarding`,
  upgraded from fire-and-forget to a gated handoff) and re-checked on the
  discovery wizard's `onClose`. The existing first-run→discovery auto-chain
  (`handleFirstRunDoneOpenDiscovery`) is reconciled so discovery opens once,
  after the profile, not competing.
- **`onComplete` seam.** `openDiscoverySetupWizard(options)` gains an optional
  `onComplete`/`onClose` callback (≈5 lines, no wizard internals touched) so the
  gate can react when the wizard closes — completed vs. not.
- **Suppress silent skip for onboarding.** For `entryPoint: "onboarding"`, the
  autodetect "already set up → toast + return" path instead routes to a visible
  "Discovery is connected ✓" confirmation (or renders the wizard's `ready`
  step), so the user always sees a discovery surface.
- **Escape + nudge.** A new `discoverySetupSkipped` flag in
  `user-content-store.js` (set only via the confirmed escape) lets the user
  reach the dashboard. `whats-next-banner.js` already surfaces the discovery
  row; it keeps nudging while `discoverySetupComplete` is false (the skip flag
  does not satisfy completion — it only unlocks the dashboard).
- **Completion semantics unchanged.** `isDiscoverySetupComplete` still means
  "the pipeline connected" (set by the wizard's finish / a healthy autodetect),
  never by the escape.

## Components touched (for the plan)

| File | Change |
|------|--------|
| `onboarding-wizard.js` | `advanceToDiscoveryAfterOnboarding` → gated, blocking handoff; re-assert on close-without-complete |
| `discovery-wizard-ui.js` | `openDiscoverySetupWizard`: `onComplete` callback; suppress silent toast-and-return for `entryPoint:"onboarding"` (visible confirmation instead) |
| `first-run-wizard.js` | reconcile the existing first-run→discovery auto-chain so discovery opens once, after the profile |
| `user-content-store.js` | add `discoverySetupSkipped` (or `discoverySetupDeferredAt`) flag trio |
| `whats-next-banner.js` | keep nudging the discovery row while incomplete (skip ≠ complete) |
| `index.html` / partial | the blocking "Discovery is required" gate panel + the confirm-gated escape control |

## Testing

- New user with no discovery: the wizard renders as a required step; closing it
  without completing re-asserts the gate (cannot reach the dashboard).
- Healthy local stack: a visible "Discovery is connected ✓" confirmation shows
  (NOT a silent toast); the gate is satisfied.
- Confirmed escape: writes `discoverySetupSkipped`, unlocks the dashboard, and
  the "Finish setup" card keeps the discovery row visible (still incomplete).
- Idempotent: when `discoverySetupComplete` is already true the gate passes
  straight through.
- The discovery wizard's own internals are untouched — existing discovery tests
  stay green.

## Out of scope

- Rewriting/folding the discovery wizard internals.
- Changing the go-live (multi-device) wizard.
- The optional post-setup enhancements (separate spec:
  `2026-06-09-optional-enhancements-wizard-design.md`).
