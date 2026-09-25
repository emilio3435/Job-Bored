# LANE REPORT — verify-fix

**DONE — the lane Definition of Done is met. Browser behavior remains
unverified only because the sandbox refused loopback, as recorded in §5.**

## 1. What this lane was

Lane E2 repairs the follow-up verification suite after an orchestrator run
proved that five of its nine failures were caused by stale or ambiguous test
assertions rather than the product claims. The lane scopes every OneFlow beat
locator, corrects the Beat 1 DOM-property assertion, and replaces the removed
pre-OneFlow wizard tests with one six-beat greenfield journey.

## 2. Which claims went red first

The orchestrator ran the unmodified lane at `1607f02` outside the sandbox
before this follow-up began. Raw transcript:
`docs/programs/greenfield-remediation-20260902/evidence/verify-base-red-orchestrator-run.txt`.

```text
$ npm run test:e2e-onboarding

Running 9 tests using 1 worker

  ✘  1 tests/e2e-onboarding/greenfield-onboarding.spec.mjs:451:1 › VAL-WIZ-001: login gate sign-in opens the first-run wizard (15.7s)
  ✘  2 tests/e2e-onboarding/greenfield-onboarding.spec.mjs:458:1 › VAL-WIZ-002: Sheet and provider steps hand off to profile onboarding (16.7s)
  ✘  3 tests/e2e-onboarding/greenfield-onboarding.spec.mjs:465:1 › VAL-WIZ-003: completion survives a clean-URL reload and Settings reopens setup (15.6s)
  ✘  4 tests/e2e-onboarding/greenfield-remediation.spec.mjs:191:1 › E1 Beat 3 is gated on Beat 2 (15.7s)
  ✘  5 tests/e2e-onboarding/greenfield-remediation.spec.mjs:246:1 › E2 Pasted resume survives Escape and reload (1.1s)
  ✘  6 tests/e2e-onboarding/greenfield-remediation.spec.mjs:277:1 › E3 Drawer setup lands in OneFlow (16.3s)
  ✘  7 tests/e2e-onboarding/greenfield-remediation.spec.mjs:291:1 › E4 Beat 1 never punts to Settings (16.3s)
  ✘  8 tests/e2e-onboarding/greenfield-remediation.spec.mjs:308:1 › E5 Payoff is honest (15.6s)
  ✘  9 tests/e2e-onboarding/greenfield-remediation.spec.mjs:336:1 › E6 Settings shows receipts (16.2s)

  9 failed
```

E1, E3, E5, and E6 reached and failed their product assertions. The five
wrong-reason failures repaired by this lane were:

```text
VAL-WIZ-001 / VAL-WIZ-002
Locator: getByRole('heading', { name: 'Connect Google' })
Expected: visible
Error: element(s) not found

VAL-WIZ-003
Expected: "http://127.0.0.1:62135/?greenfield=1"
Received: "http://127.0.0.1:62135/"

E2
Error: strict mode violation: locator('#oneFlowMount [data-beat-id="resume"]') resolved to 2 elements:
    1) <li aria-current="step" data-beat-id="resume" class="discovery-setup-wizard__spine-step discovery-setup-wizard__spine-step--current">…</li>
    2) <div class="oneflow-beat" data-beat-id="resume">…</div>

E4
Error: expect(locator).toHaveAttribute(expected) failed
Locator: locator('#oneFlowMount details.oneflow-google__detour')
Expected: ""
Received: serializes to the same string
```

## 3. What shipped

COMMITTED LOCALLY — `047c7ca test(greenfield): repair onboarding verification assertions`

FOLLOW-UP COMMITTED LOCALLY — `3b0f26a test(greenfield): correct payoff action id`

- `tests/e2e-onboarding/greenfield-remediation.spec.mjs` — added the scoped
  `.oneflow-beat[data-beat-id]` locator helper, routed every beat assertion
  through it, and changed E4 to assert the live `details.open` property and
  focused Client ID input.
- `tests/e2e-onboarding/greenfield-onboarding.spec.mjs` — replaced
  `VAL-WIZ-001/002/003` with `VAL-ONEFLOW-001`, a single visible S0 → B1–B6
  journey. Extended only its existing hermetic boundary harness for the live
  provider check, starter template/profile write, SerpApi check/key write, and
  worker restart used by those beats. Its payoff assertion waits with the
  default Playwright timeout for `payoff_run_now` or either not-ready primary,
  covering lane C's asynchronous readiness repaint.
- `LANE-REPORT-verify-fix.md` — this required five-section handoff; ignored by
  Git and retained at the worktree root.

No product file changed. The tracked diff is confined to
`tests/e2e-onboarding/**`.

## 4. Floor results

### `npm test` — BLOCKED by executor policy

```text
$ npm test
exec_command failed for `/bin/zsh -lc 'npm test'`: ProcessFailed { message: "Network access to \"127.0.0.1\" was blocked: local/private network addresses are blocked by the sandbox policy." }
```

No terminal test summary exists, so this is not green proof.

### `npm run lint:repo` — GREEN

```text
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
```

### `npm run typecheck:repo` — GREEN

```text
> command-center@0.1.0 typecheck:repo
> npm run typecheck:browser-use-discovery && node --check app.js && node --check discovery-coach.js && node --check discovery-payload.js && node --check expired-review.js && node --check dev-server.mjs && node --check discovery-wizard-local.js && node --check discovery-wizard-probes.js && node --check discovery-wizard-relay.js && node --check discovery-wizard-shell.js && node --check discovery-wizard-ui.js && node --check discovery-wizard-verify.js && node --check discovery-setup-modals.js && node --check role-materials.js && node --check materials-queue.js && node --check settings-tabs.js && node --check settings-profile-tab.js && node --check user-content-store.js && node --check onboarding-telemetry.js && node --check resume-bundle.js && node --check resume-generate.js && node --check model-download.js && node --check document-templates.js && node --check bridge-registry.js && node --check config.example.js && node --check config-overrides.js && node --check discovery-drawer.js && node --check whats-next-banner.js && node --check materials-feature.js && node --check settings-modal.js && node --check settings-tab-schema.js && node --check app-bootstrap.js && node --check app-compat.js && node --check app-config-core.js && node --check auth-session.js && node --check daily-brief.js && node --check discovery-readiness.js && node --check discovery-status-handoff.js && node --check resume-generation.js && node --check setup-doctor.js && node --check sheet-access-setup.js && node --check scripts/lib/paths.mjs && node --check scripts/lib/schedule.mjs && node --check scripts/setup.mjs && node --check scripts/run-scheduled-discovery.mjs && node --check scripts/run-scheduled-expired-cleanup.mjs && node --check scripts/install-expired-cleanup-schedule.mjs && node --check scripts/uninstall-expired-cleanup-schedule.mjs && node --check scripts/install-repo.mjs && node --check scripts/doctor.mjs && node --check scripts/install-discovery-worker-autostart.mjs && node --check scripts/uninstall-discovery-worker-autostart.mjs && node --check scripts/install-discovery-tunnel-autostart.mjs && node --check scripts/uninstall-discovery-tunnel-autostart.mjs && node --check scripts/lib/discovery-transport.mjs && node --check scripts/bootstrap-local-discovery.mjs && node --check scripts/discovery-keep-alive.mjs && node --check scripts/lib/discovery-worker-policy.mjs && npm run typecheck:server && node --check stage-registry.js && node --check pipeline.js && node --check pipeline-render.js && node --check pipeline-controller.js && node --check lattice.js && node --check dawn.js && node --check dawn-data.js && node --check expired-review-ui.js && node --check pipeline-transition-adapter.js && node --check pipeline-transitions.js && node --check today-data.js && node --check today.js && node --check jb-a11y.js && node --check fit-profile-wizard.js && node --check scribe-state.js && node --check scribe-score-adapter.js && node --check scribe.js && node --check submission-flow.js && node --check recruiter-strip.js && node --check discovery-readiness-truth.js && node --check discovery-run-preview.js && node --check dossier-field-provenance.js && node --check onboarding-flow.js && node --check oneflow-beat-google.js && node --check oneflow-beat-ai.js && node --check oneflow-beat-resume.js && node --check oneflow-beat-fit.js && node --check oneflow-beat-discovery.js && node --check oneflow-beat-payoff.js && node --check oneflow-demo-board.js && node --check onboarding-celebration.js

> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
```

### `npm run test:contract:all` — GREEN (inherited OneFlow floor)

```text
> command-center@0.1.0 test:contract
> node scripts/test-contract.mjs
OK schema: examples/discovery-webhook-request.v1.json
OK schema: examples/discovery-webhook-request.v1-with-profile.json
OK schema: examples/discovery-webhook-request.v1-preview-parity.json
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
OK discovery-readiness.js delegates to discovery-payload.js

> command-center@0.1.0 test:ats-contract
> node scripts/test-ats-scorecard-contract.mjs
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload

> command-center@0.1.0 test:pipeline-contract
> node scripts/test-pipeline-contract.mjs
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js

> command-center@0.1.0 test:pipeline-update-contract
> node scripts/test-pipeline-update-contract.mjs
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
```

### `npm run test:e2e-smoke` — BLOCKED by sandbox

```text
Running 7 tests using 1 worker
Error: listen EPERM: operation not permitted 127.0.0.1

2 failed
  tests/e2e-smoke/boot-smoke.spec.mjs:93:1 › greenfield boot produces zero console errors
  tests/e2e-smoke/case-dossier.spec.mjs:227:1 › The Case renders in a real browser from seeded pipeline data
5 did not run
```

### `npm run test:e2e-visual` — BLOCKED by sandbox

```text
Running 37 tests using 1 worker
Error: listen EPERM: operation not permitted 127.0.0.1

5 failed
  tests/e2e-visual/finale-burst.spec.mjs:95:5 › the B6 finale at 1440×900 › should fire on Beat 6 and clear itself, carrying no second payoff (1440×900)
  tests/e2e-visual/fuel-and-polish.spec.mjs:82:5 › S0 demo detail at 1440×900 › should keep the setup pill clear of an open demo detail (1440×900)
  tests/e2e-visual/inline-actions.spec.mjs:56:5 › inline beat actions at 1440×900 › should never break a control's own label across lines (1440×900)
  tests/e2e-visual/s0-structure.spec.mjs:50:5 › S0 at 1440×900 › should open on a header strip carrying the wordmark and the sample-pipeline eyebrow (1440×900)
  tests/e2e-visual/shell-structure.spec.mjs:55:5 › the one shell at 1440×900 › should carry a header strip with the flow's title and its Close control (1440×900)
32 did not run
```

### `npm run test:e2e-onboarding` — BLOCKED by sandbox

```text
Running 7 tests using 1 worker

  ✘  1 tests/e2e-onboarding/greenfield-onboarding.spec.mjs:503:1 › VAL-ONEFLOW-001: six beats reach the payoff on a fresh install (0ms)
  ✘  2 tests/e2e-onboarding/greenfield-remediation.spec.mjs:195:1 › E1 Beat 3 is gated on Beat 2 (0ms)
  -  3 tests/e2e-onboarding/greenfield-remediation.spec.mjs:250:1 › E2 Pasted resume survives Escape and reload
  -  4 tests/e2e-onboarding/greenfield-remediation.spec.mjs:281:1 › E3 Drawer setup lands in OneFlow
  -  5 tests/e2e-onboarding/greenfield-remediation.spec.mjs:295:1 › E4 Beat 1 never punts to Settings
  -  6 tests/e2e-onboarding/greenfield-remediation.spec.mjs:311:1 › E5 Payoff is honest
  -  7 tests/e2e-onboarding/greenfield-remediation.spec.mjs:339:1 › E6 Settings shows receipts

Error: listen EPERM: operation not permitted 127.0.0.1

2 failed
  tests/e2e-onboarding/greenfield-onboarding.spec.mjs:503:1 › VAL-ONEFLOW-001: six beats reach the payoff on a fresh install
  tests/e2e-onboarding/greenfield-remediation.spec.mjs:195:1 › E1 Beat 3 is gated on Beat 2
5 did not run
```

### Static onboarding collection and syntax — GREEN

```text
$ node --check tests/e2e-onboarding/greenfield-onboarding.spec.mjs
$ node --check tests/e2e-onboarding/greenfield-remediation.spec.mjs
$ npx playwright test --config tests/e2e-onboarding/playwright.config.mjs --list
Listing tests:
  greenfield-onboarding.spec.mjs:503:1 › VAL-ONEFLOW-001: six beats reach the payoff on a fresh install
  greenfield-remediation.spec.mjs:195:1 › E1 Beat 3 is gated on Beat 2
  greenfield-remediation.spec.mjs:250:1 › E2 Pasted resume survives Escape and reload
  greenfield-remediation.spec.mjs:281:1 › E3 Drawer setup lands in OneFlow
  greenfield-remediation.spec.mjs:295:1 › E4 Beat 1 never punts to Settings
  greenfield-remediation.spec.mjs:311:1 › E5 Payoff is honest
  greenfield-remediation.spec.mjs:339:1 › E6 Settings shows receipts
Total: 7 tests in 2 files
```

`git diff --check` also exited 0 with no output.

## 5. Anything unverified

1. Runtime behavior for `VAL-ONEFLOW-001` and E1–E6 remains unverified in this
   sandbox. Every attempted Playwright suite failed before browser assertions
   because its required loopback server could not bind:

   ```text
   Error: listen EPERM: operation not permitted 127.0.0.1
   ```

   The orchestrator must rerun `npm run test:e2e-onboarding` in the same
   loopback-capable environment used for the causal RED artifact.
2. `npm test` remains unverified because the executor refused the command at
   its local-network boundary; it produced no terminal TAP summary.
3. The kickoff predicted that the local commit would be refused, but the one
   required attempt succeeded after its pre-commit validation passed. Exact
   output:

   ```text
   Running pre-commit validation...
   Pre-commit validation passed.
   [feat/greenfield-verify 047c7ca] test(greenfield): repair onboarding verification assertions
    2 files changed, 214 insertions(+), 152 deletions(-)
   ```

   The commit contains exactly the two owned test files. The branch has no
   upstream and was not pushed.
4. The untracked kickoff and orchestrator RED artifact predated this lane's
   edits and were preserved untouched. They remain outside the local commit
   file list.
5. After lane C confirmed that `payoff_run_now` is the ready-state action id,
   the focused browser suite was attempted again. It reached the same setup
   refusal before any assertion:

   ```text
   Running 7 tests using 1 worker
   Error: listen EPERM: operation not permitted 127.0.0.1
   2 failed
   5 did not run
   ```

   Syntax, `git diff --check`, `npm run lint:repo`, and static Playwright
   collection were green after the correction.
6. The follow-up correction commit succeeded. Exact output:

   ```text
   Running pre-commit validation...
   Pre-commit validation passed.
   [feat/greenfield-verify 3b0f26a] test(greenfield): correct payoff action id
    2 files changed, 3 insertions(+), 3 deletions(-)
   ```
