# Discovery Setup Wizard Implementation Plan

Concrete execution plan for building the discovery setup wizard with a master
orchestrator and a parallel worker swarm.

This plan assumes the product and UX decisions in
[DISCOVERY-SETUP-WIZARD-SPEC.md](./DISCOVERY-SETUP-WIZARD-SPEC.md) are locked.

## Goal

Ship one resumable discovery setup wizard that replaces the current
modal-by-modal flow without breaking the existing BYO/static architecture.

Success means:

- every current discovery entry point resolves into one wizard
- local Hermes + ngrok + Worker is the primary greenfield path
- Apps Script stub remains available but can never masquerade as real-ready
- verification and `Run discovery` share one async-aware success model

## Delivery Strategy

The repo is currently collision-prone because discovery setup logic is spread
across a large `app.js` plus multiple modal blocks in `index.html`.

So the orchestrator should not parallelize raw `app.js` edits immediately.

Instead:

1. lock interfaces
2. create seam files for wizard-specific logic
3. assign each worker a disjoint write scope
4. let the orchestrator own final integration in `app.js` and `index.html`

## Locked Interfaces

These are the contracts every worker builds against.

### 1. `readinessSnapshot`

Produced by the probe layer and consumed by the wizard shell, Settings, empty
states, and `Run discovery`.

```json
{
  "sheetConfigured": true,
  "savedWebhookUrl": "",
  "savedWebhookKind": "none",
  "localBootstrapAvailable": false,
  "localWebhookUrl": "",
  "localWebhookReady": false,
  "tunnelPublicUrl": "",
  "tunnelReady": false,
  "relayTargetUrl": "",
  "relayReady": false,
  "engineState": "none",
  "appsScriptState": "none",
  "recommendedFlow": "local_agent",
  "blockingIssue": ""
}
```

### 2. `discoverySetupWizardState`

Persisted partial-progress state for resume-after-refresh behavior.

```json
{
  "version": 1,
  "flow": "local_agent",
  "currentStep": "relay_deploy",
  "completedSteps": [],
  "transportMode": "local_agent_worker",
  "lastProbeAt": "",
  "lastVerifiedAt": "",
  "result": "none",
  "dismissedStubWarning": false
}
```

### 3. `verificationResult`

Shared output for browser `Test webhook`, wizard verification, and
`Run discovery`.

```json
{
  "ok": true,
  "kind": "accepted_async",
  "engineState": "unverified",
  "httpStatus": 202,
  "message": "Discovery accepted — your automation queued the run",
  "detail": "",
  "layer": "downstream"
}
```

`kind` should support at least:

- `connected_ok`
- `accepted_async`
- `stub_only`
- `access_protected`
- `apps_script_private`
- `network_error`
- `invalid_endpoint`

### 4. Wizard action dispatch

The orchestrator owns one action table:

`runDiscoveryWizardAction(actionId, context)`

Workers plug into that dispatch instead of owning navigation themselves.

## File Ownership Model

To make parallel work viable, the orchestrator should create and own the
integration seams below.

### Orchestrator-owned files

Only the master orchestrator writes these:

- [app.js](/Users/emilionunezgarcia/Job-Bored/app.js)
- [index.html](/Users/emilionunezgarcia/Job-Bored/index.html)
- [docs/DISCOVERY-SETUP-WIZARD-SPEC.md](/Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-SPEC.md)
- [docs/DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md](/Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md)

Reason:

- `app.js` is the integration hot zone
- `index.html` owns the current modal stack and script load order
- spec/plan documents should have one editor

### New seam files to introduce first

These are the files the orchestrator should create before parallel execution:

- [discovery-wizard-shell.js](/Users/emilionunezgarcia/Job-Bored/discovery-wizard-shell.js)
- [discovery-wizard-probes.js](/Users/emilionunezgarcia/Job-Bored/discovery-wizard-probes.js)
- [discovery-wizard-local.js](/Users/emilionunezgarcia/Job-Bored/discovery-wizard-local.js)
- [discovery-wizard-relay.js](/Users/emilionunezgarcia/Job-Bored/discovery-wizard-relay.js)
- [discovery-wizard-verify.js](/Users/emilionunezgarcia/Job-Bored/discovery-wizard-verify.js)

These can attach namespaced globals under `window.JobBoredDiscoveryWizard.*`
to stay compatible with the current static script architecture.

## Worker Ownership

### Worker 1: Wizard Shell

Purpose:

- render the wizard UI
- manage step presentation
- keep navigation consistent

Write scope:

- [discovery-wizard-shell.js](/Users/emilionunezgarcia/Job-Bored/discovery-wizard-shell.js)
- [style.css](/Users/emilionunezgarcia/Job-Bored/style.css)

Read-only dependencies:

- [docs/DISCOVERY-SETUP-WIZARD-SPEC.md](/Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-SPEC.md)
- [index.html](/Users/emilionunezgarcia/Job-Bored/index.html)

Worker deliverables:

- wizard view model
- progress stepper UI
- CTA/footer rendering
- resume-after-refresh support from persisted wizard state
- keyboard and focus behavior

Must not edit:

- [app.js](/Users/emilionunezgarcia/Job-Bored/app.js)
- transport or verification logic

### Worker 2: Probes And State

Purpose:

- derive one normalized `readinessSnapshot`
- persist wizard progress

Write scope:

- [discovery-wizard-probes.js](/Users/emilionunezgarcia/Job-Bored/discovery-wizard-probes.js)
- [user-content-store.js](/Users/emilionunezgarcia/Job-Bored/user-content-store.js)

Read-only dependencies:

- [app.js](/Users/emilionunezgarcia/Job-Bored/app.js)
- [docs/DISCOVERY-SETUP-WIZARD-SPEC.md](/Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-SPEC.md)

Worker deliverables:

- `buildReadinessSnapshot()`
- webhook-kind classification
- wizard state read/write helpers
- reusable readiness mapping for Settings and empty states

Must not edit:

- [index.html](/Users/emilionunezgarcia/Job-Bored/index.html)
- relay/bootstrap scripts

### Worker 3: Local Agent Path

Purpose:

- make the local Hermes path feel automatic on localhost

Write scope:

- [discovery-wizard-local.js](/Users/emilionunezgarcia/Job-Bored/discovery-wizard-local.js)
- [scripts/bootstrap-local-discovery.mjs](/Users/emilionunezgarcia/Job-Bored/scripts/bootstrap-local-discovery.mjs)

Read-only dependencies:

- [app.js](/Users/emilionunezgarcia/Job-Bored/app.js)
- [docs/DISCOVERY-SETUP-WIZARD-SPEC.md](/Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-SPEC.md)

Worker deliverables:

- local bootstrap hydration adapter
- ngrok local API detection
- `/health` probing
- local branch step actions and remediation messages

Must not edit:

- [index.html](/Users/emilionunezgarcia/Job-Bored/index.html)
- Cloudflare deploy logic

### Worker 4: Relay And External Endpoint Path

Purpose:

- handle public endpoint setup after the real engine is chosen

Write scope:

- [discovery-wizard-relay.js](/Users/emilionunezgarcia/Job-Bored/discovery-wizard-relay.js)
- [scripts/deploy-cloudflare-relay.mjs](/Users/emilionunezgarcia/Job-Bored/scripts/deploy-cloudflare-relay.mjs)
- [templates/cloudflare-worker/README.md](/Users/emilionunezgarcia/Job-Bored/templates/cloudflare-worker/README.md)

Read-only dependencies:

- [app.js](/Users/emilionunezgarcia/Job-Bored/app.js)
- [docs/DISCOVERY-SETUP-WIZARD-SPEC.md](/Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-SPEC.md)

Worker deliverables:

- Worker deploy branch actions
- Worker URL apply flow
- external HTTPS endpoint branch validation
- Cloudflare auth/subdomain remediation states

Must not edit:

- [index.html](/Users/emilionunezgarcia/Job-Bored/index.html)
- local bootstrap logic

### Worker 5: Verification And QA

Purpose:

- unify “test” and “run” success semantics
- ship the greenfield QA assets

Write scope:

- [discovery-wizard-verify.js](/Users/emilionunezgarcia/Job-Bored/discovery-wizard-verify.js)
- [scripts/verify-discovery-webhook.mjs](/Users/emilionunezgarcia/Job-Bored/scripts/verify-discovery-webhook.mjs)
- [docs/QA-DISCOVERY-GREENFIELD-CHECKLIST.md](/Users/emilionunezgarcia/Job-Bored/docs/QA-DISCOVERY-GREENFIELD-CHECKLIST.md)
- [docs/QA-DISCOVERY-LOCAL-HERMES-CHECKLIST.md](/Users/emilionunezgarcia/Job-Bored/docs/QA-DISCOVERY-LOCAL-HERMES-CHECKLIST.md)

Read-only dependencies:

- [app.js](/Users/emilionunezgarcia/Job-Bored/app.js)
- [docs/DISCOVERY-SETUP-WIZARD-SPEC.md](/Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-SPEC.md)

Worker deliverables:

- shared `verificationResult` helpers
- async `202 Accepted` handling for both wizard and `Run discovery`
- local-agent QA checklist
- updated greenfield checklist aligned to the new wizard

Must not edit:

- [index.html](/Users/emilionunezgarcia/Job-Bored/index.html)
- Cloudflare or local transport setup flows

## Orchestrator Integration Responsibilities

The orchestrator is responsible for all cross-worker integration.

### Integration points in `app.js`

The orchestrator should own:

- new wizard controller bootstrap
- all entry-point routing into the wizard
- replacement of current modal-open actions with wizard entry actions
- reuse of `readinessSnapshot` for Settings and `Run discovery`
- final retirement of old modal paths

### Integration points in `index.html`

The orchestrator should own:

- script tag load order for new seam files
- one wizard mount container
- replacement of Settings buttons and links to route into the wizard
- eventual removal of the old discovery modal markup

## Execution Order

### Phase 0: Orchestrator Prep

Orchestrator only.

Tasks:

- create the five seam files with empty exported namespaces
- add script tags for them in [index.html](/Users/emilionunezgarcia/Job-Bored/index.html)
- define the exact interface names and payload shapes
- add this plan and keep the spec current

Merge gate:

- no behavior change yet
- repo still boots

### Phase 1: Parallel Foundations

Workers 1 and 2 can run in parallel after Phase 0 lands.

Tasks:

- Worker 1 builds the shell
- Worker 2 builds the snapshot and wizard-state persistence

Merge gate:

- orchestrator can open a placeholder wizard driven by mock state
- no transport actions yet

### Phase 2: Parallel Action Lanes

Workers 3, 4, and 5 can run in parallel after Phase 1 interfaces are stable.

Tasks:

- Worker 3 plugs in local-agent branch actions
- Worker 4 plugs in relay and external-endpoint actions
- Worker 5 plugs in verification and QA

Merge gate:

- wizard steps execute real actions through shared dispatch
- no duplicate success logic between test and run

### Phase 3: Orchestrator Cutover

Orchestrator only.

Tasks:

- point all existing discovery entry points at the wizard
- reuse `readinessSnapshot` in Settings and empty states
- demote old discovery modals from primary UX

Merge gate:

- `?setup=discovery` opens the wizard
- Settings uses one primary `Open discovery setup` CTA

### Phase 4: Modal Retirement

Orchestrator, with small follow-up help from Workers 1 and 5 if needed.

Tasks:

- remove or dead-code old discovery setup modals
- clean up duplicate copy
- finalize docs and QA checklists

Merge gate:

- all acceptance criteria from the spec pass

## Merge Rules

The orchestrator should enforce these branch rules:

- no worker edits another worker’s owned files
- workers may read any file, but only write their assigned scope
- all `app.js` edits land through orchestrator integration branches
- all `index.html` edits land through orchestrator integration branches
- behavior changes to success/error semantics require Worker 5 sign-off

## Acceptance Gates Per Worker

### Worker 1

- wizard shell can render any step from mock data
- focus management works
- shell supports back/next/close/resume

### Worker 2

- one snapshot call can classify saved state without opening modals
- wizard state survives refresh
- Settings can reuse the same snapshot

### Worker 3

- localhost bootstrap file autofills the local branch
- ngrok detection works without manual paste when available
- local health failures produce exact remediation copy

### Worker 4

- Worker deploy path can generate and apply a browser-facing URL
- external endpoint path rejects local-only and stub-only misuse
- relay failures classify auth vs access vs propagation issues

### Worker 5

- `Test webhook` and `Run discovery` share one verifier model
- async `202 Accepted` is treated as success where appropriate
- QA docs cover both local-agent and no-webhook paths

## Risks And Mitigations

### Risk: parallel edits collide in `app.js`

Mitigation:

- orchestrator-only ownership for `app.js`
- workers implement seam files, not core integration

### Risk: wizard becomes a thin wrapper over old confusing copy

Mitigation:

- Worker 1 owns shell clarity
- orchestrator removes parallel modal entry points during cutover

### Risk: success semantics stay inconsistent

Mitigation:

- Worker 5 owns `verificationResult`
- orchestrator blocks merge until both test and run use it

### Risk: local path still feels manual

Mitigation:

- Worker 3 owns autofill and ngrok detection
- acceptance requires “no docs first” greenfield success on localhost

## Recommended First Sprint

If the team wants the smallest useful slice first:

1. orchestrator lands seam files and wizard mount
2. Worker 1 ships the shell
3. Worker 2 ships `readinessSnapshot`
4. Worker 3 ships local bootstrap autofill
5. Worker 5 ships shared verifier behavior

That gets the repo to a believable first cut quickly, before the Cloudflare
lane is fully polished.
