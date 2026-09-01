# Lane L0 — substrate (serial-first; every other lane builds on your first commits)

Read `docs/programs/oneflow-20260831/GROUND-RULES.md` and `SUBSTRATE.md` fully, then spec §3 (flow architecture) and §5 headers.

**Mission:** Build the one-flow substrate dark: the flow controller, shell extensions, persistence, telemetry vocabulary, and registered stubs for every beat module — with the legacy chain untouched and the full floor green.

## Deliverables (in commit order — dependents gate on commit 1)

1. **Commit 1 — contracts.** `onboarding-flow.js` (`window.JobBoredOneFlow` exactly per SUBSTRATE contract: registerBeat/maybeStart/open/getState, state machine S0+B1–B6, resume-on-open, beat_opened/completed/skipped/abandoned emission); `user-content-store.js` += `getOnboardingFlowState`/`saveOnboardingFlowState` (key `onboardingFlowState`, `{version:3, beat, completedBeats, skipped, startedAt}`, debounced-safe like saveDiscoverySetupWizardState :529); `onboarding-telemetry.js` STEPS += `flow_opened, beat_opened, beat_completed, beat_skipped, beat_abandoned, flow_completed, key_check, first_results` (frozen, referenced as STEPS.*).
2. **Shell extensions** in `discovery-wizard-shell.js`, additive and inert for existing hosts: (a) when the host passes `spine: {beats:[…], current, timeLabel}`, render a 6-segment spine + minutes label INSTEAD of the journey strip; (b) `message`/`messageTone` ("info"|"success"|"error") in `buildShellContext`, rendered under the actions region; (c) `setBusy(actionId, stages)` → disables that action, renders a live `✓/◌/·` stage list, `clearBusy()` on completion. Existing discovery/go-live/enhancements hosts must render byte-identically when they pass none of these.
3. **Stubs + wiring.** Create `oneflow-beat-google.js`, `oneflow-beat-ai.js`, `oneflow-beat-resume.js`, `oneflow-beat-fit.js`, `oneflow-beat-discovery.js`, `oneflow-beat-payoff.js`, `oneflow-demo-board.js`, `onboarding-celebration.js` (empty IIFE stub — L4 moves the celebration player into it) — each an IIFE that registers its beat with the normative headline/sub from spec §5 rendered as a static placeholder card and `order`/`timeLabel` set; `css/oneflow.css` skeleton with fenced regions `/* ONEFLOW:CORE */ … /* ONEFLOW:L1 */ … L2 … L3 … L4 …`; `index.html` += `#oneFlowMount` (near the other wizard mounts, ~line 1574 region) + one `<link>` for the css + script tags for ALL new files placed AFTER the `user-content-store.js` tag; `package.json` `typecheck:repo` += `node --check` for every new file.
4. **Do NOT wire boot.** `maybeStart()` exists, is exported, is tested by direct call — and nothing in `app-bootstrap.js` calls it yet (L6 does that). Grep-proof it in your report.

## Tests (tests/oneflow-l0-*.test.mjs)

- Controller: registration order, state persistence round-trip, resume-on-open lands on saved beat, migration guard (`isInfraSetupComplete && isOnboardingComplete` → `maybeStart()` returns false and writes completed), abandon on close emits with reason.
- Shell: spine renders 6 segments with correct done/current classes; message slot renders and re-renders by tone; setBusy disables the action and advances stages; legacy host snapshot unchanged (render the discovery wizard's detect step before/after your change, assert identical HTML).
- Telemetry: new STEPS present and frozen.

## Definition of Done

All four floor commands green (pasted); legacy wizards render unchanged; `grep -rn "maybeStart" app-bootstrap.js discovery-status-handoff.js` returns nothing; report complete; everything committed locally, never pushed.
