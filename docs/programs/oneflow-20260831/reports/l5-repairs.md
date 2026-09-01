# Lane L5 report

## 1. What this lane was

Lane L5 delivered the standalone Phase 0 repairs and documentation corrections
owned by `KICKOFF-L5-repairs.md`: remove the false gcloud OAuth bootstrap,
broaden the repo installer Node gate, correct discovery-lockfile diagnostics,
publish the GIS initialization timestamp, and make the three setup documents
tell one accurate story.

## 2. Which claims went red first (named tests)

`npm test -- tests/oneflow-l5-repairs.test.mjs` ran before implementation and
reported 0 pass / 5 fail. Each named claim failed at its intended assertion:

- `accepts every supported Node major from 20 upward while rejecting 19`
- `accepts the repository-tracked discovery lockfile and warns only when it is unexpected`
- `publishes the GIS start time so SetupDoctor can detect an 8-second stall`
- `removes the false OAuth bootstrap without leaving a runtime route or caller`
- `documents the same 25 Pipeline columns that the starter-sheet code creates`

## 3. What shipped, file-and-fence

- `scripts/oauth-bootstrap.mjs` and `tests/oauth-bootstrap.test.mjs` were deleted;
  the matching handler/route and route-specific integration assertions were
  removed from `dev-server.mjs` and
  `tests/integration/greenfield-automation.test.mjs`.
- `setup-doctor.js` no longer registers the false gcloud OAuth auto-fix.
- `sheet-access-setup.js` keeps the existing gate button but its click handler
  now returns the manual-steps toast without calling a deleted endpoint. This is
  the kickoff mission's explicit handler exception to the tabulated L5 fence.
- `scripts/install-repo.mjs` accepts Node majors 20 and newer while preserving
  the dependency fingerprint and install-stamp behavior.
- `scripts/doctor.mjs` accepts the repository-tracked discovery lockfile, warns
  on an untracked copy, and reports git-inspection uncertainty as info.
- `auth-session.js` publishes `window.gisInitStartedAt` when GIS initialization
  begins, making the existing `gis_stuck` detector reachable.
- `README.md`, `QUICKSTART.md`, and `SETUP.md` now carry the requested OAuth,
  localhost, clone-target, zero-install, named-flow, no-manual-edit, lockfile,
  and 25-column corrections.
- `tests/oneflow-l5-repairs.test.mjs` locks all five L5 Phase 0 claims.

## 4. Floor results — PASTED output, not paraphrased

### `npm test`

```text
$ npm test
Network access to "127.0.0.1" was blocked: local/private network addresses are blocked by the sandbox policy.
```

The command was refused before execution, so it produced no test result.

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

OK schema: examples/discovery-webhook-request.v1.json
OK schema: examples/discovery-webhook-request.v1-with-profile.json
OK schema: examples/discovery-webhook-request.v1-preview-parity.json
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
OK discovery-readiness.js delegates to discovery-payload.js
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md
```

### Supplemental socket-free proof

```text
$ npm test -- tests/oneflow-l5-repairs.test.mjs
ℹ tests 5
ℹ suites 1
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

```text
$ npm test -- <357 top-level test files with no listen/localhost/127.0.0.1 reference>
ℹ tests 1538
ℹ suites 379
ℹ pass 1537
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 2447.789916
```

The one todo is the existing `submission-record-audit` canonical-ownership gate;
it is not counted as a pass.

## 5. Anything unverified, including what the sandbox refused

The sandbox refused this targeted listener-based command before execution:

```text
$ npm test -- tests/setup-doctor.test.mjs tests/doctor.test.mjs tests/integration/greenfield-automation.test.mjs tests/install-repo-runner-normalization.test.mjs tests/first-run-wizard-sheet-step-interactive.test.mjs
Network access to "127.0.0.1" was blocked: local/private network addresses are blocked by the sandbox policy.
```

The same command without the listener-based integration file passed 39/39.
The required unfiltered `npm test` result is pasted in section 4.

The unfiltered floor and a second broad top-level invocation were both refused
before execution for the same sandbox rule. The 357-file socket-free selection
then ran 1,538 tests with 1,537 passing and one existing todo, pasted in section
4. Because `npm test` itself never ran, the full-floor DoD and commit gate remain
unverified.

OAuth removal grep proof:

```text
$ rg -n "/__proxy/oauth-bootstrap|scripts/oauth-bootstrap\\.mjs|gcloud_can_create_oauth" dev-server.mjs setup-doctor.js sheet-access-setup.js scripts auth-session.js app.js index.html
(no output; exit 1)
```
