# Discovery Setup Wizard Spec

Design spec for replacing the current manual discovery setup flow with one guided wizard. The goal is to make greenfield onboarding feel like a product flow, not a docs scavenger hunt.

## Summary

Today the app spreads discovery setup across:

- Settings form fields
- `discoveryHelpModal`
- `discoveryPathsModal`
- `discoverySetupGuideModal`
- `discoveryLocalTunnelModal`
- `cloudflareRelaySetupModal`
- Apps Script deploy controls inside Settings

That is accurate, but it is not onboarding-grade. Users must infer the difference between:

- real discovery engine
- local webhook
- ngrok tunnel
- Cloudflare Worker URL
- Apps Script stub

The wizard should turn that into one orchestrated flow with branching, state detection, autofill, verification, and a final “ready” state.

## Product Goal

Make `Run discovery` setup feel like:

1. Pick how you want discovery to work.
2. Let the app detect what it can.
3. Let the app or helper scripts do the setup where possible.
4. Stop only for true human-auth steps.
5. End with a verified outcome, not just pasted URLs.

## Non-Goals

- Building a maintainer-hosted discovery backend
- Hiding the BYO architecture
- Pretending the Apps Script stub is a real engine
- Forcing every user into the browser `Run discovery` path when scheduled discovery is enough

## Current Pain Points

### UX problems

- The app exposes transport concepts before user intent is clear.
- The user must manually jump between multiple setup modals.
- The same path is explained in Settings, docs, helper scripts, and status toasts with different levels of detail.
- The Cloudflare step still reads like infra setup, not product onboarding.
- Apps Script deploy is visible beside the real path, so stub wiring and real automation are easy to confuse.

### State problems

- Discovery readiness is shown, but setup progress is not.
- Transport details live in browser storage, discovery readiness lives in IndexedDB, and local bootstrap lives in a repo file.
- The app knows enough to branch, but the user still has to choose the right modal manually.

### Greenfield problems

- A first-time user does not know whether they even need a webhook.
- A local-agent user should never have to paste the local webhook URL by hand after bootstrap.
- An async `202 Accepted` receiver is valid, but the user still does not get a clear “queued and ready” story.

## Design Principles

1. Intent first, infrastructure second.
2. One primary flow, with branches only when the app has enough signal.
3. Show plain-language roles:
   - real engine
   - public tunnel
   - browser URL
4. Autofill whenever the repo or browser already knows the answer.
5. Separate “stub wired” from “real discovery ready” everywhere.
6. Verification must be step-native, not a side quest.
7. Keep the current BYO/static architecture intact.

## User Outcomes

The wizard must support four outcomes:

1. `No webhook needed`
   Use manual or scheduled discovery only. `Run discovery` stays disabled by design.

2. `External real endpoint connected`
   User already has a real HTTPS endpoint. Save and verify it.

3. `Local agent path connected`
   Local Hermes/OpenClaw webhook is the real engine, ngrok is the tunnel, Cloudflare Worker is the browser URL.

4. `Stub-only path acknowledged`
   Apps Script stub may be deployed for smoke tests, but the wizard must label it as stub-only and block any false “ready” state.

## Wizard Entry Points

All current discovery entry points should converge into one wizard shell:

- `Run discovery` help when no usable endpoint exists
- Settings `Setup guide`
- Settings `Hermes + ngrok`
- Settings `Cloudflare relay`
- Deep link `?setup=discovery`
- Empty Pipeline CTA
- Daily Brief empty-state CTA

These entry points may open the wizard at different starting steps, but they should not open separate standalone setup modals anymore.

## Architecture Decision

Use a dedicated `discoverySetupWizard` controller that reuses the existing
onboarding wizard visual language and stepper patterns, but does **not** reuse
the current blocking onboarding flow or add more standalone discovery modals.

That means:

- the app remains usable while discovery setup is incomplete
- the wizard is resumable and can open from multiple entry points
- the existing discovery actions remain as effectors
- the current modal maze becomes implementation detail, then gets retired

The wizard should own orchestration only. It should call existing effectors
wherever they already work:

- Apps Script deploy / re-check public access
- local bootstrap hydration and local health checks
- Cloudflare relay command generation and Worker URL apply
- browser-side webhook test and `Run discovery`

## Proposed Wizard

Wizard ID: `discoverySetupWizard`

### Step 0 — Choose your path

Question:
`How do you want jobs to get into Pipeline?`

Choices:

- `I already have a real HTTPS endpoint`
- `My discovery agent runs on this machine`
- `I only want scheduled/manual discovery for now`
- `I want to test webhook wiring only`

Behavior:

- If the app already detects saved state, preselect the most likely path.
- If a managed Apps Script stub is currently configured, show a warning chip: `Stub only`.

### Step 1 — Detect what already exists

The orchestrator runs lightweight probes and shows a checklist:

- Sheet configured?
- Discovery webhook URL already saved?
- Saved endpoint looks like Worker, Apps Script, or generic URL?
- Local bootstrap file available on localhost?
- Local webhook + ngrok transport info already saved?
- Discovery engine state is `none`, `stub_only`, `unverified`, or `connected`?

The user sees progress, not raw implementation details.

### Step 2A — No webhook needed

For scheduled/manual users:

- explain that Pipeline works without `Run discovery`
- offer docs for GitHub Actions / scheduled paths
- save a wizard completion record with `mode = no_webhook`
- leave the button disabled with clear copy

### Step 2B — Existing endpoint

For users who already have a real endpoint:

- prompt for the URL
- explain what a real endpoint means
- reject known bad values:
  - local-only URL on hosted dashboard
  - Worker `/forward`
  - managed Apps Script stub as “real”
- run `Test webhook`
- classify result:
  - `connected`
  - `unverified`
  - `stub_only`

### Step 2C — Local agent

This is the primary greenfield path.

Substeps:

1. `Bootstrap local receiver`
   - primary CTA: run `npm run discovery:bootstrap-local`
   - on localhost, read `discovery-local-bootstrap.json`
   - autofill:
     - local webhook URL
     - health URL
     - ngrok public URL
     - public target URL
     - suggested Cloudflare command

2. `Confirm local health`
   - show `/health`
   - if reachable, mark local engine ready
   - if not, show exact remediation

3. `Connect public tunnel`
   - if ngrok is already running, auto-detect from `http://127.0.0.1:4040/api/tunnels`
   - if ngrok auth is missing, explain the one-time auth step and link to the token page
   - if tunnel is ready, do not ask the user to paste the URL manually unless detection failed

4. `Deploy browser relay`
   - show generated `TARGET_URL`
   - run the relay helper path
   - stop only for Cloudflare auth/subdomain steps
   - save the Worker URL back into `Discovery webhook URL`

5. `Verify end-to-end`
   - run browser-side webhook test
   - accept async `202 Accepted`
   - show exactly which layer succeeded:
     - Worker reachable
     - downstream accepted
     - discovery queued

6. `Ready`
   - summarize:
     - real engine: local webhook
     - public tunnel: ngrok
     - browser URL: Worker
   - offer `Run discovery now`

### Step 2D — Stub-only wiring

For users who explicitly choose webhook smoke tests:

- allow Apps Script deploy and test flow
- label it as `Stub only`
- do not mark setup complete for real discovery
- route to real paths when the user wants actual Pipeline rows

## Orchestrator Contract

The master orchestrator should normalize all current discovery signals into one
derived `readinessSnapshot`, then route the wizard from that object instead of
reading raw browser stores ad hoc from each step.

Suggested shape:

```json
{
  "sheetConfigured": true,
  "savedWebhookUrl": "https://jobbored-discovery-relay.example.workers.dev",
  "savedWebhookKind": "worker",
  "localBootstrapAvailable": true,
  "localWebhookUrl": "http://127.0.0.1:8644/webhooks/command-center-discovery-abc123",
  "localWebhookReady": true,
  "tunnelPublicUrl": "https://abc123.ngrok-free.app",
  "tunnelReady": true,
  "relayTargetUrl": "https://abc123.ngrok-free.app/webhooks/command-center-discovery-abc123",
  "relayReady": true,
  "engineState": "unverified",
  "appsScriptState": "stub_only",
  "recommendedFlow": "local_agent",
  "blockingIssue": ""
}
```

This snapshot should be the single source of truth for:

- wizard branch selection
- Settings discovery status copy
- `Run discovery` enable/disable state
- empty-state and CTA language

## Wizard State Model

Reuse existing state where possible and add one wizard-specific state object.

### Existing state to keep

- `command_center_config_overrides` in localStorage
- `command_center_discovery_transport_setup` in localStorage
- `discoveryEngineState` in IndexedDB via `user-content-store.js`
- `appsScriptDeployState` in IndexedDB
- `discovery-local-bootstrap.json` on localhost

### New state to add

`discoverySetupWizardState`

Suggested shape:

```json
{
  "version": 1,
  "flow": "local_agent",
  "currentStep": "relay_deploy",
  "completedSteps": ["path_select", "detect", "bootstrap", "local_health"],
  "transportMode": "local_agent_worker",
  "lastProbeAt": "2026-04-09T12:00:00.000Z",
  "lastVerifiedAt": "2026-04-09T12:03:00.000Z",
  "result": "unverified",
  "dismissedStubWarning": false
}
```

This belongs in IndexedDB with the other user-content state, not in the repo bootstrap file.

## Detection Rules

The wizard orchestrator should own one probe pass that normalizes all discovery signals into a single readiness snapshot.

Suggested derived fields:

- `sheetConfigured`
- `savedWebhookUrl`
- `savedWebhookKind`
  - `none`
  - `apps_script_stub`
  - `worker`
  - `generic_https`
  - `local_http`
- `localBootstrapAvailable`
- `localWebhookReady`
- `tunnelReady`
- `relayReady`
- `engineState`
  - `none`
  - `stub_only`
  - `unverified`
  - `connected`

This snapshot should drive the wizard, the Settings status card, and the `Run discovery` button. One source of truth.

Detection should explicitly reuse current helpers where possible:

- saved webhook classification via URL-kind helpers and relay-target inference
- local bootstrap hydration from `discovery-local-bootstrap.json` on localhost
- tunnel detection from the ngrok local API
- discovery engine state from IndexedDB
- Apps Script public-access and stub detection from the current deploy state

One inconsistency must be removed as part of the wizard work:

- `Test webhook` already accepts async `202 Accepted`
- `Run discovery` must use the same success model instead of requiring
  `ok: true`

## UX Copy Rules

- Never say “paste your webhook” before explaining what the webhook is for.
- Never lead with Cloudflare unless the user has already chosen browser `Run discovery`.
- Never present the Apps Script stub and local-agent path as equivalent.
- Every step should answer:
  - what this thing is
  - why the user needs it
  - what the app can do automatically
  - what the user must do manually

## Information Architecture Changes

### Keep

- Discovery readiness card in Settings
- `Run discovery` help affordance
- Apps Script deploy controls for stub-only testing

### Replace

- `discoveryHelpModal`
- `discoveryPathsModal`
- `discoverySetupGuideModal`
- `discoveryLocalTunnelModal`
- `cloudflareRelaySetupModal`

These become wizard steps, not separate modal systems.

### Reframe

- Settings should show a single button:
  `Open discovery setup`
- Secondary text links can remain, but should route into wizard branches, not parallel docs-first flows.

## Master Orchestrator + Swarm Build Plan

The feature should be built by a master orchestrator coordinating parallel agents with clear ownership.

### Master Orchestrator

Responsibilities:

- own the product contract for the wizard
- own `readinessSnapshot` derivation
- define the state machine and branch rules
- merge agent outputs
- prevent UI drift between branches
- enforce the “stub wired != real ready” rule everywhere

Main files:

- `app.js`
- `index.html`
- `user-content-store.js`
- `docs/DISCOVERY-SETUP-WIZARD-SPEC.md`

### Agent 1 — UX shell and stepper

Build:

- wizard modal/container
- progress UI
- step components
- step routing and back/next behavior
- resume-after-refresh behavior from persisted wizard state

Touches:

- `index.html`
- wizard CSS already in app stylesheet blocks if needed
- `app.js` view wiring only

Ownership boundary:

- owns the shell, layout, copy slots, CTA placement, and keyboard behavior
- does **not** own discovery probes or transport logic

### Agent 2 — discovery probe layer

Build:

- unified readiness snapshot builder
- webhook kind detection
- step gating inputs
- Settings/empty-state/readiness reuse

Touches:

- `app.js`
- `user-content-store.js`

Ownership boundary:

- owns the derived state contract
- does **not** own modal HTML or deploy scripts

### Agent 3 — local bootstrap integration

Build:

- localhost bootstrap polling/hydration
- ngrok local API detection
- local health checks
- local-agent wizard branch

Touches:

- `app.js`
- `scripts/bootstrap-local-discovery.mjs`

Ownership boundary:

- owns local-agent setup and autofill behavior
- does **not** own Cloudflare deploy UX or Settings status copy

### Agent 4 — relay deployment integration

Build:

- Worker deploy branch inside wizard
- Cloudflare auth handoff UX
- Worker URL apply-and-test path
- relay-specific failure states

Touches:

- `app.js`
- `templates/cloudflare-worker/README.md`
- relay helper scripts if needed

Ownership boundary:

- owns browser-facing relay setup and verification handoff
- does **not** own local webhook or ngrok detection

### Agent 5 — verification, telemetry, and QA

Build:

- wizard completion markers
- step-native verification messaging
- greenfield QA checklist for local-agent flow
- instrumentation for where users stall
- shared verifier behavior for `Test webhook` and `Run discovery`

Touches:

- `app.js`
- `scripts/verify-discovery-webhook.mjs`
- `docs/QA-DISCOVERY-LOCAL-HERMES-CHECKLIST.md`

Ownership boundary:

- owns success/failure semantics and QA assets
- does **not** own wizard shell markup

## Interfaces Between Agents

The orchestrator should lock these interfaces before parallel implementation:

1. `readinessSnapshot`
   Agent 2 publishes the derived state shape. Everyone else reads it.

2. `discoverySetupWizardState`
   Agent 5 owns persistence shape; Agent 1 consumes it for resume behavior.

3. `runWizardAction(stepActionId, context)`
   The orchestrator owns the dispatch table so Agent 3 and Agent 4 can plug in
   local and relay actions without forking step navigation.

4. `verificationResult`
   Agent 5 defines the shared result shape used by Settings, the wizard, and
   `Run discovery`.

## Build Order

### Phase 1 — Wrapper wizard

Goal: unify entry points fast without rewriting every implementation detail.

- add wizard shell
- route existing modal logic into step panels
- centralize path selection and status detection
- preserve current effectors behind the new step container

This gets the product shape right quickly.

### Phase 2 — Native step actions

Goal: remove manual copy-paste where the app already knows the answer.

- bootstrap file hydration
- ngrok tunnel auto-detection
- local health auto-check
- relay command generation inside the wizard
- shared verifier result model for test and run

### Phase 3 — Retire modal maze

Goal: reduce maintenance cost and contradictory copy.

- delete standalone discovery setup modals
- keep docs as support material, not primary UX
- collapse Settings buttons into one wizard entry point plus advanced links
- remove duplicated copy paths that drifted across Settings and docs

## Acceptance Criteria

The wizard is done when:

1. A greenfield localhost user can reach a verified local-agent setup without reading repo docs first.
2. The app autofills the local webhook URL after `npm run discovery:bootstrap-local`.
3. The app auto-detects an ngrok tunnel when it is already running.
4. A managed Apps Script deploy is always labeled `Stub only`.
5. The wizard never marks stub wiring as `connected`.
6. Browser verification accepts async `202 Accepted`.
7. `Run discovery` becomes enabled only for `connected` or intentionally `unverified` real endpoints.
8. All current discovery setup entry points resolve into the same wizard.

## QA Scenarios

- Fresh localhost user, no webhook
- Fresh localhost user, local Hermes path
- ngrok not authenticated
- ngrok already running
- Cloudflare auth missing
- Worker URL pasted incorrectly
- Apps Script stub configured
- Existing real endpoint already saved
- Scheduled/manual-only user who never wants the button

## Open Questions

- Should the wizard render as a modal overlay or replace the Settings body when
  entered from `?setup=discovery`?
- Do we want lightweight telemetry in localStorage/IndexedDB for drop-off
  analysis during greenfield QA, or keep that QA-only at first?

## Recommended Decision

Build the discovery wizard as a separate, resumable setup wizard that reuses
the visual language of the existing onboarding wizard, but does not block the
whole app. It should be intent-driven, powered by one orchestrator-owned
readiness snapshot, and built by parallel agents against locked interfaces.

That gives us the simplest user story:

- the app stays usable
- discovery setup becomes understandable
- local real discovery gets a first-class path
- stub wiring stays available but cannot masquerade as production readiness
