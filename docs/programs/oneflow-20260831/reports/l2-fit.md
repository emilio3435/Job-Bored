# Lane L2 Report

## 1. What this lane was

Lane L2 implemented Beat 4 (the one-flow fit confirmation screen), repaired
the discovery and server-rescore hard-constraint behavior, and repaired the
surviving Settings fit-profile editor. The implementation fence was
`oneflow-beat-fit.js`, the L2 region of `css/oneflow.css`,
`integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts`,
`server/profile-rescore-worker.mjs`, `fit-profile-wizard.js`, and
`fit-profile-editor.js`, plus L2-owned tests and this required report.

## 2. Which claims went red first (named tests)

- `ONEFLOW-L2 §5 B4: workMode=any never hard-rejects a saved location mismatch`
  failed `false !== true` in the TypeScript scorer.
- `ONEFLOW-L2 §10 Phase 0: salaryFloor rejects a published salary below the
  floor without salaryRequired` failed `true !== false` in the TypeScript
  scorer.
- `L2-SCORER-MJS-LOCATION`, `L2-SCORER-MJS-LOCATION-GATE`,
  `L2-SCORER-MJS-SALARY`, and `L2-SCORER-MJS-SALARY-MISSING` all failed
  because the server mirror did not expose or run a prefilter.
- `L2-SCORER-MJS-SALARY-PARSE` failed during the final parity audit because
  the server mirror classified `40 hours` as a published salary instead of
  `salary_missing_but_required`.
- `L2-FIT-LAYOUT`, `L2-FIT-VALIDATION`, and `L2-FIT-SINGLE-WRITE` failed
  against the L0 placeholder (zero cards and no action handler).
- `ONEFLOW-L2-FETCH-ON-OPEN` failed because default open entered `create`
  instead of loading the saved profile.
- `ONEFLOW-L2-FIT-DETAILS` failed because `workMode=any` exposed locations;
  `ONEFLOW-L2-FIT-SENIORITY` failed because enum ids rendered as labels.
- `L2-FIT-HINT` and `L2-FIT-EDITOR-COPY` failed on the old location hint and
  the surviving `Task #6` / `Rescore all` fossil.

## 3. What shipped, file-and-fence

- `oneflow-beat-fit.js`: replaced the registered B4 stub with the three-card
  confirm-don't-compose review, editable role/want/avoid chips, reorderable
  strengths, inline narrative editing, human seniority labels, the conditional
  details fields, raw JSON disclosure, inline validation, exactly one discovery
  profile save plus one `/profile` POST, and `completeBeat({ edited })` only
  after both writes resolve.
- `css/oneflow.css`: added B4 styles only between `/* ONEFLOW:L2 */` and the
  next lane fence.
- `integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts`:
  limited the location hard reject to hybrid/onsite and decoupled published
  below-floor salary rejection from `salaryRequired`.
- `server/profile-rescore-worker.mjs`: mirrored the discovery hard filter and
  salary parser, and applies it before provider scoring during pipeline
  rescoring.
- `fit-profile-wizard.js`: default/reopen now fetches and merges the saved
  profile before rendering; Any/Remote only hide location controls; seniority
  labels are human-readable.
- `fit-profile-editor.js`: removed the `Task #6` fossil and named the rendered
  button `Rescore`.
- L2-owned tests plus the affected existing scorer/wizard tests encode the
  behavior above. No production file outside the lane fence changed.

## 4. Floor results — PASTED output, not paraphrased

### `npm test`

```text
ProcessFailed { message: "Network access to \"127.0.0.1\" was blocked: local/private network addresses are blocked by sandbox policy." }
```

### `npm run lint:repo`

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 lint:js
> eslint .

npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
```

### `npm run typecheck:repo`

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 typecheck:repo
> npm run typecheck:browser-use-discovery && node --check app.js && node --check discovery-coach.js && node --check discovery-payload.js && node --check expired-review.js && node --check dev-server.mjs && node --check discovery-wizard-local.js && node --check discovery-wizard-probes.js && node --check discovery-wizard-relay.js && node --check discovery-wizard-shell.js && node --check discovery-wizard-ui.js && node --check discovery-wizard-verify.js && node --check discovery-setup-modals.js && node --check role-brief.js && node --check role-materials.js && node --check materials-queue.js && node --check settings-tabs.js && node --check settings-profile-tab.js && node --check user-content-store.js && node --check onboarding-telemetry.js && node --check resume-bundle.js && node --check resume-generate.js && node --check model-download.js && node --check document-templates.js && node --check bridge-registry.js && node --check config.example.js && node --check config-overrides.js && node --check discovery-drawer.js && node --check first-run-wizard.js && node --check whats-next-banner.js && node --check materials-feature.js && node --check onboarding-wizard.js && node --check settings-modal.js && node --check settings-tab-schema.js && node --check app-bootstrap.js && node --check app-compat.js && node --check app-config-core.js && node --check auth-session.js && node --check daily-brief.js && node --check discovery-readiness.js && node --check discovery-status-handoff.js && node --check resume-generation.js && node --check setup-doctor.js && node --check sheet-access-setup.js && node --check scripts/lib/paths.mjs && node --check scripts/lib/schedule.mjs && node --check scripts/setup.mjs && node --check scripts/run-scheduled-discovery.mjs && node --check scripts/run-scheduled-expired-cleanup.mjs && node --check scripts/install-expired-cleanup-schedule.mjs && node --check scripts/uninstall-expired-cleanup-schedule.mjs && node --check scripts/install-repo.mjs && node --check scripts/doctor.mjs && node --check scripts/install-discovery-worker-autostart.mjs && node --check scripts/uninstall-discovery-worker-autostart.mjs && node --check scripts/install-discovery-tunnel-autostart.mjs && node --check scripts/uninstall-discovery-tunnel-autostart.mjs && node --check scripts/lib/discovery-transport.mjs && node --check scripts/bootstrap-local-discovery.mjs && node --check scripts/discovery-keep-alive.mjs && npm run typecheck:server && node --check enhancements-wizard-ui.js && node --check stage-registry.js && node --check pipeline.js && node --check pipeline-render.js && node --check pipeline-controller.js && node --check lattice.js && node --check dawn.js && node --check dawn-data.js && node --check expired-review-ui.js && node --check pipeline-transition-adapter.js && node --check pipeline-transitions.js && node --check today-data.js && node --check today.js && node --check jb-a11y.js && node --check fit-profile-wizard.js && node --check scribe-state.js && node --check scribe-score-adapter.js && node --check scribe.js && node --check submission-flow.js && node --check recruiter-strip.js && node --check discovery-readiness-truth.js && node --check discovery-run-preview.js && node --check dossier-field-provenance.js && node --check onboarding-flow.js && node --check oneflow-beat-google.js && node --check oneflow-beat-ai.js && node --check oneflow-beat-resume.js && node --check oneflow-beat-fit.js && node --check oneflow-beat-discovery.js && node --check oneflow-beat-payoff.js && node --check oneflow-demo-board.js && node --check onboarding-celebration.js

npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
```

### `npm run test:contract:all`

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 test:contract:all
> npm run test:contract && npm run test:ats-contract && npm run test:pipeline-contract && npm run test:pipeline-update-contract && npm run lint:skills

npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 test:contract
> node scripts/test-contract.mjs

OK schema: examples/discovery-webhook-request.v1.json
OK schema: examples/discovery-webhook-request.v1-with-profile.json
OK schema: examples/discovery-webhook-request.v1-preview-parity.json
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
OK discovery-readiness.js delegates to discovery-payload.js
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 test:ats-contract
> node scripts/test-ats-scorecard-contract.mjs

OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 test:pipeline-contract
> node scripts/test-pipeline-contract.mjs

OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 test:pipeline-update-contract
> node scripts/test-pipeline-update-contract.mjs

OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
```

## 5. Anything unverified, including what the sandbox refused

- The only counted test gate, unchanged `npm test`, could not start because the
  sandbox refused loopback access. Exact refusal is pasted in §4, so the full
  floor is **not claimed green**.
- The discovery package suite ran 727 tests: 726 passed and one existing
  network-safety probe failed outside this lane's fence. Neither the probe nor
  its implementation has a lane diff. Literal tail:

  ```text
  ℹ tests 727
  ℹ suites 2
  ℹ pass 726
  ℹ fail 1
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 2579.774

  ✖ failing tests:

  test at integrations/browser-use-discovery/tests/sources/safe-fetch.test.ts:31:1
  ✖ worker safeFetch fails at connect when DNS rebinds to loopback (8.926ms)
    AssertionError [ERR_ASSERTION]: Missing expected rejection.
  ```

- `npm run typecheck:browser-use-discovery` passed. The focused scorer proof
  passed 17/17 TypeScript tests and 5/5 server-mirror tests. The focused B4,
  wizard, accessibility, settings, and copy proof passed 78/78 tests.
- A targeted root profile-rescore/E2E invocation was also refused at
  `127.0.0.1`; no substitute is reported as equivalent to the blocked root
  gate. Live browser traversal remains for integration after the dark-landing
  beat lanes merge.
- The required local stage/commit was refused at the linked-worktree metadata
  boundary. Per `GROUND-RULES.md`, it was not retried or bypassed. Literal
  output:

  ```text
  fatal: Unable to create '/Users/emilionunezgarcia/Job-Bored/.git/worktrees/oneflow-fit/index.lock': Operation not permitted
  ```

  The worktree therefore remains dirty for the integrator to rescue.
- No push or other publication was attempted.
