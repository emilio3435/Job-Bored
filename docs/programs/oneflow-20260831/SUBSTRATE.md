# ONEFLOW program — architecture & locked decisions

Program: implement `docs/ONE-FLOW-ONBOARDING-SPEC.md` (approved v2) end to end. Integration branch: `feat/oneflow-integration` (off origin/main @ 96b0928). One PR to main at the end; `gh pr merge --rebase` once all 7 required checks are green. This repo's "production" IS main — there is no other deploy surface.

## Locked decisions (override anything contrary elsewhere)

1. **Dark landing.** L0 substrate and every beat lane land UNWIRED: new modules exist, register, and are unit-tested, but boot still runs the legacy chain. Only L6 (cutover) flips `app-bootstrap.js` / `discovery-status-handoff.js` to the new flow. Every intermediate merge keeps the full floor green.
2. **One shell, JS-rendered beats.** Beats render through `discovery-wizard-shell.js` exactly like the discovery wizard does today (`createEl`-built DOM). `index.html` gains ONLY: one mount (`#oneFlowMount`), script tags for the new modules, and fenced CSS/section comments — all added by L0. No beat lane edits `index.html`. L6/L7 are the only lanes that delete from it.
3. **L0 creates every new file as a registered stub** (beat registers with a placeholder render + one passing probe test), adds all script tags in correct load order (AFTER `user-content-store.js` — the welcome.js death was load-order), and adds every new file to `typecheck:repo` in `package.json`. Beat lanes then ONLY fill their own files.
4. **Single-owner shared files.** `discovery-wizard-shell.js`, `user-content-store.js`, `onboarding-telemetry.js`, `package.json`, `index.html`, `css/oneflow.css` (skeleton with per-lane fenced regions) → L0 only. Later lanes append inside their own named fence in `css/oneflow.css` and never touch the rest.
5. **PR strategy:** one integration branch, one PR. Emilio approved commit/push/merge explicitly (2026-08-31 22:45). Merge via `gh pr merge <n> --rebase`. Never push main directly.
6. **Legacy tests:** a lane that changes behavior owns updating the tests that pin it. L6/L7 own deleting tests for deleted surfaces. Test-file ownership is listed per kickoff; new tests live in `tests/oneflow-<lane>-*.test.mjs` so lanes never collide.

## The flow controller contract (L0 builds; everyone consumes)

`onboarding-flow.js` — classic-global IIFE, `window.JobBoredOneFlow`:

```js
JobBoredOneFlow.registerBeat({
  id: "google" | "ai" | "resume" | "fit" | "discovery" | "payoff",
  order: 1..6,
  timeLabel: "about 15 min left",
  render(container, ctx),      // ctx = { state, runtime, setMessage(text, tone), setBusy(actionId, stages), completeBeat(detail), skipBeat(detail), goToBeat(id) }
  onAction(actionId, ctx),
});
JobBoredOneFlow.maybeStart();          // entry decision incl. §3.3 migration — L6 wires this into boot
JobBoredOneFlow.open(beatId?);         // used by S0 invite card / pill
JobBoredOneFlow.getState();            // { version:3, beat, completedBeats:[], skipped:{}, startedAt }
```

- Persistence: `user-content-store.js` gains `getOnboardingFlowState()` / `saveOnboardingFlowState(partial)` (IndexedDB `settings` key `onboardingFlowState`, pattern of `saveDiscoverySetupWizardState` :529).
- Shell additions (L0, in `discovery-wizard-shell.js`): 6-segment spine + minutes-remaining label replacing the journey strip when host === oneflow; `message`/`messageTone` rendered under actions (fixes the silent-feedback defect, :497-530); `setBusy(actionId, stages)` that disables the action and live-renders a stage list (`✓/◌/·` rows).
- Telemetry (L0, `onboarding-telemetry.js` STEPS += ): `flow_opened, beat_opened, beat_completed, beat_skipped, beat_abandoned, flow_completed, key_check, first_results`. Controller emits opened/completed/skipped/abandoned itself; beats pass `detail`.
- Completion side-effects (controller, on payoff exit): write `onboardingComplete`, `infraSetupComplete`, and `discoverySetupComplete` when connect succeeded — every legacy reader keeps working.

## Dependency edges

```
L0 substrate ──> everything else (serial-first, lands alone)
L1 arrival (B1+B2+B3)  ─┐
L2 fit (B4 + scorer)    ├─ parallel after L0 merges
L3 engine (B5)          │
L4 bookends (S0+B6)     │
L5 repairs/docs         ┘  (no L0 dependency, may start with L0)
L6 cutover  ──> after L1–L5 all merged + floor green (serial)
L7 sweep    ──> after L6 merged + floor green (serial)
```

## File ownership map (fences)

| File(s) | Owner |
|---|---|
| discovery-wizard-shell.js, user-content-store.js, onboarding-telemetry.js, index.html (additive), package.json, onboarding-flow.js, css/oneflow.css skeleton, all new-file stubs | **L0** |
| oneflow-beat-google.js, oneflow-beat-ai.js, oneflow-beat-resume.js; server/profile-from-resume.mjs; server resume-writer route; resume-generate.js (provider check reuse only) | **L1** |
| oneflow-beat-fit.js; integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts; server/profile-rescore-worker.mjs; fit-profile-wizard.js (fetch-on-open); fit-profile-editor.js | **L2** |
| oneflow-beat-discovery.js; discovery-wizard-ui.js (autodetect visibility, busy states, onboarding bypass removal); discovery-wizard-verify.js (catch-all next-action) | **L3** |
| oneflow-demo-board.js; oneflow-beat-payoff.js; fixtures/demo-pipeline.json; go-live-wizard-ui.js (single-device exit, cloud unblock, button hierarchy); whats-next-banner.js; onboarding-wizard.js celebration player extraction only | **L4** |
| scripts/oauth-bootstrap.mjs (+ its gate button removal is L7), scripts/install-repo.mjs, scripts/doctor.mjs, setup-doctor.js, auth-session.js (gis publish), README.md, QUICKSTART.md, SETUP.md | **L5** |
| app-bootstrap.js, discovery-status-handoff.js (boot cutover + migration), integration tests for the new flow | **L6** |
| Deletions: enhancements-wizard-ui.js, discovery gate, welcome.js onboarding half + WELCOME.md, partials/discovery-modals.html + discovery-setup-modals.js, partials/first-run-wizard.html + first-run-wizard.js, partials/onboarding-wizard.html + onboarding-wizard.js (minus celebration player), #setupScreen, dead flags/elements, fossils, their tests; Settings → Upgrades card; index.html removals | **L7** |

Conflict-avoidance: every lane's new tests carry its lane letter; any cross-fence need goes to the orchestrator, never edited around.
