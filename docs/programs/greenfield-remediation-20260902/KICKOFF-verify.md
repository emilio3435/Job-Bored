# KICKOFF — lane E `verify` (claim ids E1–E6)

Read `GROUND-RULES.md`, then `GREENFIELD-SPEC.md` §4 (every seam) and §4.6. Create `LANE-REPORT-verify.md` before anything else.

## Mission
Build the automated greenfield gate: one Playwright spec that walks a fresh install through the six beats and asserts the outcomes lanes A–D are shipping, written **red against the integration base** so it turns green only when their work is merged. Your branch already contains the cherry-picked journey from `9b93cdb` (`tests/e2e-onboarding/greenfield-onboarding.spec.mjs`, its Playwright config, and the `test:e2e-onboarding` script) — extend it, do not rewrite it.

## Fence (you own exactly these)
- `tests/e2e-onboarding/**` — a new `greenfield-remediation.spec.mjs` plus any helpers; you may refactor shared helpers out of the existing journey spec into `tests/e2e-onboarding/helpers/`.
- The `test:e2e-onboarding` line in `package.json` (already present from the cherry-pick; keep it).
- `docs/programs/greenfield-remediation-20260902/evidence/**` — your run logs and screenshots.

No product files. If a claim cannot be asserted without a product change, write the exact missing hook into report §5 and assert what you can.

## Claims (each a `test()` named by id; each must be RED on your branch as created)
- **E1** Beat 3 gated on Beat 2 (spec §4.6 row E1). Drive the flow with `?greenfield=1`; use `window.JobBoredOneFlow.open("resume")` via `page.evaluate` for the gate half; for the guard half, write `command_center_config_overrides` with `resumeProvider: "openrouter"` and an empty key, mark `ai` complete in the flow state (IndexedDB `settings` store, key `onboardingFlowState`), then assert no request to `/profile/from-resume` and the locked copy.
- **E2** Pasted resume survives Escape + reload, for `type()` and `fill()` (row E2).
- **E3** Drawer setup lands in OneFlow (row E3). Reach the board with a configured install (stage the same fake OAuth keys the existing journey uses), open the drawer's Connection tab, click `#settingsDiscoveryOpenSetupBtn`.
- **E4** Beat 1 never punts to Settings (row E4).
- **E5** Payoff is honest (row E5). Reach Beat 6 with no Sheet by driving `open("payoff")` after marking `google` complete but with `sheetId` blank — note lane A's gate treats `google` in `completedBeats` as satisfied, so this path is reachable by design.
- **E6** Settings shows receipts (row E6), including that completing the beat opened from "Change in setup" closes the shell.

## Sandbox
Playwright needs the dev server (`PORT=8096 node dev-server.mjs`, see the existing config's `webServer`). If the sandbox refuses to bind or to launch Chromium, paste the exact error into report §5 and stop at "spec written, red not observed"; the orchestrator runs it. Do not `.skip`, do not weaken assertions to get green.

## Definition of Done
- Six tests exist, each named `E<n> …`, each red on the branch as created (paste the red run, or the sandbox refusal).
- `npm run lint:repo` green on your branch.
- Report §3 lists every file. Commit locally if the sandbox allows; otherwise `UNCOMMITTED — rescue commit needed` at the top of §3. Never push.
