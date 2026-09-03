# KICKOFF — lane G `verify-green` (claim ids E1–E6 + VAL-ONEFLOW-001)

Read `GROUND-RULES.md`, `GREENFIELD-SPEC.md` §4 and §4.6, then `.lane-evidence/integration-onboarding-run.txt` (the orchestrator's run of `npm run test:e2e-onboarding` on the fully merged integration branch, which is your base). Create `LANE-REPORT-verify-green.md` before anything else.

## Mission
Every test in `tests/e2e-onboarding/` is green against this branch, by fixing the TESTS. Lanes A–F have landed; the product is the reference. You can run Playwright here (`npm run test:e2e-onboarding`); the two Codex lanes that wrote these tests could not, which is why they miss.

## What the orchestrator already diagnosed (verify, don't assume)
- **E1**: product renders the locked copy and a button labeled "Connect an AI provider" (`data-action-id="resume_connect_ai"`, `oneflow-beat-resume.js`). The test filters `button` by `/connect ai/i`, which "Connect an AI provider" does not match. Select by action id.
- **E2, E6**: `getByText("Setup paused — …")` / `getByText("Saved.")` hit both the visible toast and the screen-reader live region. Scope to `#toastContainer` (or `.first()`). E6 reached "Saved.", so the return-to-close seam works.
- **E5**: Beat 6 reads `sheetId` from `host.getConfig()` (`oneflow-beat-payoff.js:115-135`), not from `host.getSheetId`, so blanking the getter does nothing while the hermetic AUTH still supplies a Sheet. Stage the no-Sheet state through the config override (`command_center_config_overrides` with `sheetId: ""`, or the harness's AUTH without `sheetId`) and reboot before `open("payoff")`.
- **VAL-ONEFLOW-001**: `stageHarnessAuth` waits for `globalThis.__JOBBORED_E2E_GIS__ && typeof JobBoredApp.core.host.initAuth === "function"` and times out at Beat 1 although the beat rendered. `initAuth` is exposed through `bridge-registry.js:212`; find where the hermetic harness's GIS stub and the host actually live on this build and wait on the right predicate. The journey must also honor lane A's gate (Beat 2 must verify before Beat 3 opens) and lane C's Beat 1 detour, and end on `payoff_run_now` when a Sheet and roles exist.

## Fence
`tests/e2e-onboarding/**` and `tests/e2e-fixtures/hermetic-harness.mjs` only if a harness fix is genuinely required (say so in §5). No product files: if a test can only pass with a product change, write the exact line and the reason into report §5 and leave that test red.

## Definition of Done
`npm run test:e2e-onboarding` → 7 passed, output pasted in §4; `npm run lint:repo` green; commit locally, never push.
