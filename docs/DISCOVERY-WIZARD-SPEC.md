# Discovery Wizard Spec

## Why This Exists

The current discovery onboarding is functional but fragmented.

Today a new user has to piece together:

- `Settings -> Discovery webhook URL`
- `Setup guide`
- `Hermes + ngrok`
- `Cloudflare relay`
- `Test webhook`
- managed Apps Script deploy state
- discovery readiness labels such as `stub_only`, `unverified`, and `connected`

That is too much hidden model-building for greenfield users. The app already has the right primitives, but they are spread across multiple modals and require the user to understand three different endpoint roles:

- local webhook = real engine
- ngrok URL = public tunnel
- Cloudflare Worker URL = browser-facing URL saved in JobBored

The wizard should make those roles explicit, auto-detect as much as possible, and only ask the user for the next missing fact.

## Product Decision

Add a single discovery setup wizard that owns the happy path and branches into the right flow.

The wizard must preserve the repo's current product stance:

- keep the BYO/static architecture
- do not introduce a maintainer-hosted discovery service
- do not imply the managed Apps Script stub is real discovery
- support real local discovery, real hosted discovery, stub-only verification, and no-webhook usage

## Goals

- Replace multi-modal setup spelunking with one guided flow.
- Make the endpoint roles impossible to confuse.
- Prefer real discovery paths over stub wiring.
- Reuse existing bootstrap, relay, and verification helpers instead of inventing parallel logic.
- Auto-advance whenever existing local/browser state already proves a step is done.
- Keep `Run discovery` correctly blocked or relabeled unless a real engine is connected.

## Non-Goals

- Building or hosting a shared discovery service for users.
- Reading secrets out of `~/.hermes` or ngrok config from the browser.
- Turning the bundled Apps Script stub into a default real discovery engine.
- Replacing scheduled/manual discovery paths for users who do not want a browser-triggered webhook.

## Current Repo Constraints

The wizard must respect the current implementation constraints:

- The dashboard is a static browser app. It cannot directly inspect `~/.hermes`.
- Local bootstrap is exposed to localhost via [`discovery-local-bootstrap.json`](../discovery-local-bootstrap.json) and the ngrok local API on `http://127.0.0.1:4040/api/tunnels`.
- Discovery transport hints already live in browser storage under `command_center_discovery_transport_setup` in [app.js](../app.js).
- Discovery readiness already persists as `none`, `stub_only`, `unverified`, or `connected` in [user-content-store.js](../user-content-store.js).
- The browser-facing saved endpoint is either:
  - a real hosted HTTPS endpoint, or
  - a `workers.dev` relay URL
- The saved endpoint must never be a localhost URL or raw ngrok tunnel URL for hosted/browser usage.
- Success must accept both:
  - `{"ok": true}`
  - async accepted responses such as Hermes `202 Accepted`
- The managed Apps Script path is stub-only unless replaced with real logic.

## Existing Building Blocks To Reuse

- Bootstrap helper: [scripts/bootstrap-local-discovery.mjs](../scripts/bootstrap-local-discovery.mjs)
- Browser verifier: [scripts/verify-discovery-webhook.mjs](../scripts/verify-discovery-webhook.mjs)
- Current transport state hydration: [app.js](../app.js)
- Current discovery transport storage: [app.js](../app.js)
- Current readiness persistence: [user-content-store.js](../user-content-store.js)
- Current modal copy and entry points: [index.html](../index.html)
- Existing onboarding shell patterns: `#onboardingWizard` in [index.html](../index.html)

## Proposed User Experience

### Primary Entry Points

Add one primary CTA: `Connect discovery`.

It should open from:

- `Settings -> Discovery & scraping`
- blocked `Run discovery` states
- `?setup=discovery`
- the empty-state CTA when Pipeline has no rows and discovery is not connected

Keep the existing `Setup guide`, `Hermes + ngrok`, and `Cloudflare relay` affordances only as advanced links inside the wizard or behind an "advanced tools" disclosure.

### Path Choice Screen

The first screen asks one question:

`Where will real discovery run?`

Choices:

1. `On this machine`
   Use when Hermes/OpenClaw/local automation runs on the user's computer.
2. `At an HTTPS URL I already have`
   Use when the user already owns a real hosted endpoint.
3. `I only want to smoke-test the stub`
   Explicitly marked as not real discovery.
4. `I do not need the browser button`
   For scheduled/manual discovery only.

The wizard should default to `On this machine` when:

- origin is localhost, and
- the app detects local bootstrap state or a saved local transport setup

### Branch A: Local Real Discovery

This becomes the default greenfield path for localhost users.

Step A1: `Bootstrap local receiver`

- Show one command first: `npm run discovery:bootstrap-local`
- If bootstrap state already exists, skip the command wall and show detected values immediately.
- If bootstrap failed because ngrok auth is missing, show one link to ngrok token setup and one rerun command.

Step A2: `Detect local facts automatically`

The wizard reads:

- `discovery-local-bootstrap.json`
- `command_center_discovery_transport_setup`
- ngrok local API when available

It should auto-populate and label:

- local webhook URL
- local `/health` URL
- public ngrok URL
- public relay target URL

The user should only paste values that the app truly cannot discover.

Step A3: `Create browser-safe relay`

- Show the generated Cloudflare deploy command from the bootstrap data.
- Explain plainly:
  - local webhook = real engine
  - Worker URL = what goes into JobBored
- Accept the pasted `workers.dev` URL and save it directly into `Discovery webhook URL`.

Step A4: `Verify`

- Run browser `Test webhook`
- Treat async accepted responses as success
- If verification succeeds, mark readiness `connected`
- If the endpoint is reachable but cannot yet prove real row writes, mark `unverified` and explain the difference

Step A5: `Done`

Show one short summary:

- saved Worker URL
- downstream target
- current readiness label
- next action: `Run discovery`

### Branch B: Real Hosted Endpoint

Step B1: `Paste your real discovery URL`

- Accept a real hosted URL or a Worker URL.
- Immediately classify it:
  - Apps Script `/exec`
  - Cloudflare Worker
  - generic HTTPS endpoint
  - invalid/local URL

Step B2: `Test and classify`

- Run the browser verifier
- Outcomes:
  - real success -> `connected` or `unverified`
  - Apps Script stub markers -> `stub_only`
  - Apps Script public access failure -> show Google remediation
  - CORS/network issue for Apps Script -> branch into relay substep

Step B3: `Optional relay substep`

Only show this if:

- the downstream URL exists, and
- direct browser POST is blocked by CORS or a browser-only network path

Step B4: `Done`

### Branch C: Stub Smoke Test Only

This is intentionally not a happy-path completion for real discovery.

Step C1: `Explain the limit`

The wizard must say:

- the Apps Script stub can verify webhook wiring
- it does not discover real jobs
- `Run discovery` stays blocked or stub-labeled until a real engine is connected

Step C2: `Deploy or reuse stub`

Reuse the current managed Apps Script deploy flow and public-access gate.

Step C3: `Test stub`

On success, persist `stub_only`.

Step C4: `Choose next move`

Offer exactly two next CTAs:

- `Connect a real local agent`
- `Use a real hosted endpoint`

### Branch D: No Browser Webhook

This is a valid completion.

The wizard should say:

- Pipeline works without a webhook
- `Run discovery` stays disabled by design
- use scheduled/manual automation instead

It should link to:

- [docs/DISCOVERY-PATHS.md](./DISCOVERY-PATHS.md)
- [integrations/openclaw-command-center/README.md](../integrations/openclaw-command-center/README.md)

## Wizard State Model

Add one canonical in-app state object for the wizard.

```js
{
  pathChoice: "local_agent" | "hosted_endpoint" | "apps_script_stub" | "manual_only" | "",
  currentStepId: string,
  lastCompletedStepId: string,
  facts: {
    sheetId: string,
    oauthClientId: string,
    discoveryWebhookUrl: string,
    localWebhookUrl: string,
    localHealthUrl: string,
    tunnelPublicUrl: string,
    publicTargetUrl: string,
    workerUrl: string,
    managedAppsScriptUrl: string,
    bootstrapStateLoadedAt: string,
    verifyStatus: "idle" | "running" | "passed" | "failed",
    verifyResultKind: "ok_true" | "accepted_async" | "stub_only" | "cors" | "apps_script_private" | "cloudflare_access" | "unknown"
  }
}
```

Derived state should continue to come from existing canonical sources:

- config overrides
- discovery transport setup state
- Apps Script deploy state
- discovery engine state

The wizard state is orchestration state, not a replacement for those persisted facts.

## Wizard State Machine

Canonical events:

- `wizard.opened`
- `path.selected`
- `config.saved`
- `bootstrap.detected`
- `bootstrap.failed`
- `tunnel.detected`
- `relay.url.saved`
- `verify.started`
- `verify.succeeded`
- `verify.failed`
- `engine.state.changed`
- `wizard.completed`

Rules:

- A saved localhost or ngrok URL can never be treated as the final browser-facing discovery URL.
- `stub_only` is terminal for the stub branch, but never equivalent to real readiness.
- `accepted_async` is success for transport verification.
- The wizard always resumes at the first unmet requirement, not the first screen.

## UI Structure

Reuse the existing onboarding pattern instead of opening a fourth discovery modal.

Add:

- a single modal shell with progress bar and step label
- left-side path summary on desktop
- one primary action and one secondary action per step
- a compact "Why am I seeing this?" explainer for blocked states

Recommended shell reuse:

- mirror the structure of `#onboardingWizard`
- do not invent a separate visual language for discovery setup

## Automation Rules

The wizard should auto-detect and auto-advance when safe:

- If `discovery-local-bootstrap.json` exists on localhost, hydrate immediately.
- If ngrok's local API exposes a tunnel for the detected port, fill the public URL immediately.
- If `Discovery webhook URL` is already a valid `workers.dev` URL, prefill the relay step as complete.
- If `Test webhook` already proved `stub_only`, route the user into the stub branch summary instead of pretending discovery is ready.
- If `Test webhook` already proved `connected` or `unverified`, open directly to the done screen.

## Copy Principles

The wizard copy should be calmer than the current modals.

Required copy rules:

- never ask the user to infer the difference between local, ngrok, and Worker URLs
- never describe ngrok auth as more than "one-time"
- never present Cloudflare before the app knows the downstream target
- never say "real discovery connected" for the Apps Script stub path
- every error message must include the next concrete action, not just the failure

## Master Orchestrator Design

One master orchestrator owns the state machine, sequencing, and merge acceptance.

Responsibilities:

- define the canonical wizard state shape
- define the step registry and branch rules
- own shared helpers and selectors
- keep `connected` vs `stub_only` vs `unverified` coherent across all branches
- review every agent branch for state/schema drift
- merge in dependency order

The orchestrator should not hand-author every UI step. It should own the contracts between specialists.

## Swarm Build Plan

### Agent 1: Wizard Shell And Routing

Own:

- wizard modal shell in [index.html](../index.html)
- progress bar and step navigation
- entry points from Settings, blocked Run discovery states, and `?setup=discovery`
- resume logic to reopen at the first unmet step

Touches:

- [index.html](../index.html)
- [app.js](../app.js)

### Agent 2: Local Bootstrap Integration

Own:

- reading localhost bootstrap state
- polling ngrok local API
- step logic for local webhook, `/health`, ngrok URL, and public target
- rendering the local-branch summary

Touches:

- [app.js](../app.js)
- [scripts/bootstrap-local-discovery.mjs](../scripts/bootstrap-local-discovery.mjs) only if the wizard needs richer machine output

### Agent 3: Relay And Hosted Endpoint Branches

Own:

- Worker-target generation
- hosted URL classification
- relay substep
- saving/pasting Worker URLs cleanly back into settings

Touches:

- [app.js](../app.js)
- [index.html](../index.html)
- [templates/cloudflare-worker/README.md](../templates/cloudflare-worker/README.md) if copy changes are needed

### Agent 4: Apps Script Stub Branch

Own:

- explicit stub branch UX
- public-access remediation state inside the wizard
- stub completion summary that routes users toward a real engine

Touches:

- [app.js](../app.js)
- [index.html](../index.html)

### Agent 5: Verification And Readiness

Own:

- one shared verification adapter for browser tests and CLI logic
- success/error normalization
- readiness persistence updates
- transport-success vs real-engine-success labeling

Touches:

- [app.js](../app.js)
- [scripts/verify-discovery-webhook.mjs](../scripts/verify-discovery-webhook.mjs)
- [user-content-store.js](../user-content-store.js) only if schema expansion is required

### Agent 6: QA And Docs

Own:

- greenfield wizard checklist
- regression matrix by branch
- updated setup docs after implementation lands

Touches:

- [docs/QA-DISCOVERY-GREENFIELD-CHECKLIST.md](./QA-DISCOVERY-GREENFIELD-CHECKLIST.md)
- [SETUP.md](../SETUP.md)
- [README.md](../README.md)
- [docs/DISCOVERY-PATHS.md](./DISCOVERY-PATHS.md)

## Recommended Merge Order

1. Agent 1 lands the wizard shell and state scaffolding.
2. Agent 5 lands shared verification/readiness adapters.
3. Agent 2 lands the local branch.
4. Agent 3 lands hosted/relay branching.
5. Agent 4 lands the stub-only branch and final blocked-state cleanup.
6. Agent 6 updates docs and QA after behavior settles.

The master orchestrator reviews after each merge and rejects any branch that adds duplicated storage or branch-specific truth for readiness.

## Acceptance Criteria

- A localhost greenfield user can understand the path without reading repo docs first.
- The local branch asks for at most:
  - one bootstrap command
  - one ngrok token paste
  - one Worker URL paste
- The wizard auto-fills local facts when bootstrap data already exists.
- The wizard never asks the user to paste a localhost or ngrok URL into final `Discovery webhook URL`.
- The hosted branch can classify stub-only vs real vs relay-needed outcomes.
- The stub branch ends with `stub_only`, not `connected`.
- `accepted_async` responses pass verification everywhere the app currently expects webhook success.
- `Run discovery` messaging matches the persisted readiness state after the wizard completes.

## QA Matrix

Minimum required QA branches:

- localhost happy path with no prior state
- localhost rerun with existing bootstrap file
- ngrok token missing
- Hermes health down
- ngrok running but not yet wired into Worker
- hosted real endpoint already available
- Apps Script stub path
- no-webhook/manual path
- existing connected user reopening the wizard

## Open Questions

- Should the wizard fully replace the separate discovery modals, or keep them behind an advanced disclosure for power users?
- Should `npm run discovery:bootstrap-local` gain a `--watch` mode so the wizard can instruct the user once and then simply wait for state to appear?
- Should the wizard add a local-only "open terminal helper" doc block that mirrors the Cheerio setup tone?

## Implementation Notes

- Do not create a second source of truth for discovery readiness.
- Prefer selectors that derive from current storage over step-local booleans.
- Keep all wizard-specific persistence shallow and resumable.
- Favor progressive disclosure over dumping full docs into the modal.
