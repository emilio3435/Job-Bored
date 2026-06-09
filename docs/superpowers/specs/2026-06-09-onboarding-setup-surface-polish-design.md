# Onboarding setup-surface polish — design

**Date:** 2026-06-09
**Status:** Approved (brainstorming) → implementation

## The "so what"

Three problems with the mandatory two-track onboarding surface, all reported
from the running app:

1. **Pre-login leakage.** The "Finish setup — X of 2" banner and a stale
   discovery run-status toast ("…JobBored lost the status connection…") both
   render over the **login gate**, before the user has signed in.
2. **Awkward, off-brand placement.** The setup banner renders as an in-page
   block wedged between the daily brief and the pipeline, in a flat gray style
   that doesn't match the JobBored design language.
3. **Flat completion of resume/persona setup.** Finishing the onboarding
   (resume + persona) wizard just shows a plain success toast; it neither
   celebrates nor carries the user into the next setup step (discovery).

## Decisions (locked in brainstorming)

1. **Gate both surfaces behind login.** Neither the setup banner nor the
   discovery run-status resume may run until `isSignedIn()` is true.
2. **Relocate + beautify the setup surface as a bottom-right floating card.**
   Fixed-position, on-brand (warm paper `--jb-paper`, navy ink, mint accent,
   rounded, soft shadow). Keeps the "X of 2" progress, the remaining-track
   CTA(s), the session "Later", and the gated "Don't show again". Persistent
   until snoozed/dismissed — same semantics as today, new form + position.
3. **Celebrate + auto-advance on resume/persona finish.** On finishing the
   onboarding wizard, play a delightful celebration (the celebrating-pea mascot
   pose `pose-07-celebrating.webp` + a confetti burst + "Profile set! Nice
   work.", ~1.5s), then **auto-launch discovery setup** when discovery is
   incomplete (`requestDiscoverySetup({ entryPoint: "onboarding",
   allowWhileOnboarding: true })`). Replaces the plain success toast.

## Components touched

| File | Change |
|------|--------|
| `whats-next-banner.js` | `readGateState`/`shouldRenderBanner`: read `host.isSignedIn()`; hide when signed out |
| `discovery-status-handoff.js` | `resumeDiscoveryStatusPollingIfNeeded`: early-return when signed out |
| `bridge-registry.js` | add `isSignedIn` to `discovery.status.host` |
| `css/legacy-first-run-wizard.css` (+ tokens) | `data-region="whats-next"` → fixed bottom-right floating card, brand styling; celebration overlay styles |
| `index.html` | celebration overlay markup (mascot + confetti + message) |
| `onboarding-wizard.js` | on finish: play celebration, then auto-launch discovery if incomplete |

## Behavior details

- **Login gate (banner):** `readGateState` returns `null` (→ hidden) when
  `host.isSignedIn` exists and returns false. Existing gates (infra/onboarding/
  dismissed/both-complete/session-snooze) unchanged.
- **Login gate (run status):** `resumeDiscoveryStatusPollingIfNeeded` returns
  immediately when not signed in — no toast, no polling resume. (Requires
  `isSignedIn` on the status host bridge.)
- **Floating card:** primarily CSS; the region keeps its existing markup/IDs so
  all banner behavior (progress text, CTA toggles, Later, Don't-show-again,
  anti-nag counter) is unchanged. Visual result verified in-app.
- **Celebration + auto-advance:** a single `playOnboardingCelebration(onDone)`
  helper renders the overlay, then on completion (or a max timeout) calls
  `host().requestDiscoverySetup(...)` when `isDiscoverySetupComplete()` is
  false. If discovery is already complete, no auto-open (idempotent); the
  banner still refreshes.

## Testing

- Banner: hidden when `isSignedIn()` is false even if every other gate passes.
- Run status: `resumeDiscoveryStatusPollingIfNeeded` is a no-op (no render, no
  poll) when signed out; unchanged when signed in.
- Onboarding finish: auto-launches discovery via `requestDiscoverySetup`
  (entryPoint `onboarding`) when discovery incomplete; does NOT when complete;
  the celebration helper fires exactly once.
- CSS is visual: covered by lightweight structural/source-presence assertions
  and verified in the running app.

## Out of scope

- Changing the discovery/go-live wizard internals.
- The dismiss/snooze semantics (Later session-snooze + gated permanent dismiss
  are preserved as-is).
