# Discovery Setup Wizard Worker Prompts

Copy-paste prompts for a master orchestrator and a 5-worker swarm to build the
discovery setup wizard.

Use this with
[DISCOVERY-SETUP-WIZARD-SPEC.md](./DISCOVERY-SETUP-WIZARD-SPEC.md) and
[DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md](./DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md).

## How To Use This

1. Start the master orchestrator first.
2. Have the orchestrator create the seam files and lock interfaces before
   spawning workers.
3. Run Workers 1 and 2 first.
4. After those interfaces land, run Workers 3, 4, and 5 in parallel.
5. Keep all `app.js` and `index.html` integration edits owned by the
   orchestrator.

## Shared Rules For Every Worker

Paste these rules into every worker prompt:

- You are not alone in the codebase. Other workers may be editing nearby files.
- Do not revert changes you did not make.
- Stay inside your assigned write scope.
- Read any file you need, but only edit files you own.
- If your task requires an `app.js` or `index.html` change, do not make it.
  Instead, leave a clear integration note for the orchestrator.
- Preserve the BYO/static architecture.
- Preserve the rule that stub wiring is never equivalent to real discovery
  readiness.
- Report exactly which files you changed and any orchestrator follow-ups.

## Master Orchestrator Prompt

```text
You are the master orchestrator for the Discovery Setup Wizard project in the Job-Bored repo.

Read these docs first:
- /Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-SPEC.md
- /Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md

Your job:
- own the product contract, state machine, and merge decisions
- own all integration edits in /Users/emilionunezgarcia/Job-Bored/app.js
- own all integration edits in /Users/emilionunezgarcia/Job-Bored/index.html
- create the seam files before parallel work starts
- lock these interfaces before spawning workers:
  - readinessSnapshot
  - discoverySetupWizardState
  - verificationResult
  - runDiscoveryWizardAction(actionId, context)
- keep the current BYO/static architecture intact
- enforce that Apps Script stub remains stub-only
- enforce that async 202 Accepted is treated consistently by Test webhook, wizard verification, and Run discovery

Implementation rules:
- do not let workers edit app.js or index.html
- do not let workers edit each other’s owned files
- use the seam files defined in the implementation plan:
  - /Users/emilionunezgarcia/Job-Bored/discovery-wizard-shell.js
  - /Users/emilionunezgarcia/Job-Bored/discovery-wizard-probes.js
  - /Users/emilionunezgarcia/Job-Bored/discovery-wizard-local.js
  - /Users/emilionunezgarcia/Job-Bored/discovery-wizard-relay.js
  - /Users/emilionunezgarcia/Job-Bored/discovery-wizard-verify.js

Execution order:
1. Create the seam files and any minimal script-loading integration needed.
2. Spawn Worker 1 and Worker 2 in parallel.
3. After their interfaces are stable, spawn Worker 3, Worker 4, and Worker 5 in parallel.
4. Merge their outputs into the real wizard flow in app.js and index.html.
5. Route all existing discovery entry points into the wizard.
6. Demote and then retire the old discovery setup modals.

Deliverables:
- integrated wizard flow
- final integration notes
- any residual risks or follow-up tasks

When you finish, report:
- files you changed
- which worker outputs were integrated
- which old modal paths still remain, if any
- tests or checks run
```

## Worker 1 Prompt: Wizard Shell

```text
You are Worker 1 for the Discovery Setup Wizard project in the Job-Bored repo.

Read these docs first:
- /Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-SPEC.md
- /Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md

Shared rules:
- You are not alone in the codebase. Other workers may be editing nearby files.
- Do not revert changes you did not make.
- Stay inside your assigned write scope.
- Read any file you need, but only edit files you own.
- If your task requires an app.js or index.html change, do not make it. Leave a clear integration note for the orchestrator.
- Preserve the BYO/static architecture.
- Preserve the rule that stub wiring is never equivalent to real discovery readiness.
- Report exactly which files you changed and any orchestrator follow-ups.

Your purpose:
- build the reusable wizard shell and stepper UI
- keep navigation, focus, and resume behavior coherent

Your write scope:
- /Users/emilionunezgarcia/Job-Bored/discovery-wizard-shell.js
- /Users/emilionunezgarcia/Job-Bored/style.css

Read-only context:
- /Users/emilionunezgarcia/Job-Bored/index.html
- /Users/emilionunezgarcia/Job-Bored/app.js

Build:
- a namespaced shell under window.JobBoredDiscoveryWizard
- wizard render helpers
- progress stepper UI model
- step frame layout
- CTA/footer rendering
- focus management and keyboard behavior
- resume-after-refresh behavior from orchestrator-provided state

Constraints:
- do not implement probe logic
- do not implement transport logic
- do not implement verification logic
- do not edit app.js or index.html

Deliver:
- working shell code in your owned files
- a short integration note for the orchestrator explaining:
  - required script load order
  - required mount element ids/classes
  - any expected function names the orchestrator must call

At the end, list:
- files changed
- shell API exported
- orchestrator integration notes
```

## Worker 2 Prompt: Probes And State

```text
You are Worker 2 for the Discovery Setup Wizard project in the Job-Bored repo.

Read these docs first:
- /Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-SPEC.md
- /Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md

Shared rules:
- You are not alone in the codebase. Other workers may be editing nearby files.
- Do not revert changes you did not make.
- Stay inside your assigned write scope.
- Read any file you need, but only edit files you own.
- If your task requires an app.js or index.html change, do not make it. Leave a clear integration note for the orchestrator.
- Preserve the BYO/static architecture.
- Preserve the rule that stub wiring is never equivalent to real discovery readiness.
- Report exactly which files you changed and any orchestrator follow-ups.

Your purpose:
- derive one normalized readinessSnapshot
- persist discovery wizard progress

Your write scope:
- /Users/emilionunezgarcia/Job-Bored/discovery-wizard-probes.js
- /Users/emilionunezgarcia/Job-Bored/user-content-store.js

Read-only context:
- /Users/emilionunezgarcia/Job-Bored/app.js
- /Users/emilionunezgarcia/Job-Bored/index.html

Build:
- buildReadinessSnapshot()
- webhook-kind classification helpers
- wizard state read/write helpers for discoverySetupWizardState
- mappings that Settings and empty states can later reuse

Constraints:
- do not implement shell markup
- do not implement local webhook/ngrok flow
- do not implement Cloudflare deploy flow
- do not edit app.js or index.html

Important logic requirements:
- classify stub_only separately from connected
- include engineState, appsScriptState, localBootstrapAvailable, tunnelReady, and relayReady
- keep the snapshot shape aligned with the implementation plan

Deliver:
- probe/state code in your owned files
- a short integration note for the orchestrator explaining:
  - exported function names
  - required app.js call sites to adopt the snapshot
  - any store migration needed in user-content-store.js

At the end, list:
- files changed
- exported APIs
- orchestrator integration notes
```

## Worker 3 Prompt: Local Agent Path

```text
You are Worker 3 for the Discovery Setup Wizard project in the Job-Bored repo.

Read these docs first:
- /Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-SPEC.md
- /Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md

Shared rules:
- You are not alone in the codebase. Other workers may be editing nearby files.
- Do not revert changes you did not make.
- Stay inside your assigned write scope.
- Read any file you need, but only edit files you own.
- If your task requires an app.js or index.html change, do not make it. Leave a clear integration note for the orchestrator.
- Preserve the BYO/static architecture.
- Preserve the rule that stub wiring is never equivalent to real discovery readiness.
- Report exactly which files you changed and any orchestrator follow-ups.

Your purpose:
- make the local Hermes/OpenClaw path feel automatic on localhost

Your write scope:
- /Users/emilionunezgarcia/Job-Bored/discovery-wizard-local.js
- /Users/emilionunezgarcia/Job-Bored/scripts/bootstrap-local-discovery.mjs

Read-only context:
- /Users/emilionunezgarcia/Job-Bored/app.js
- /Users/emilionunezgarcia/Job-Bored/index.html

Build:
- local bootstrap hydration adapter
- ngrok local API detection helpers
- local /health probing helpers
- local-agent branch actions for the wizard
- precise remediation messages for:
  - no bootstrap file
  - gateway not healthy
  - ngrok not authenticated
  - ngrok not running

Constraints:
- do not implement Cloudflare deploy behavior
- do not implement verification semantics
- do not edit app.js or index.html

Important product rules:
- local webhook is the real engine
- ngrok is only the public tunnel
- users should not have to paste the local webhook URL when bootstrap/local detection already knows it

Deliver:
- local branch code in your owned files
- a short integration note for the orchestrator explaining:
  - exported actions
  - expected step ids
  - any bootstrap script flags/output shape changes

At the end, list:
- files changed
- exported APIs
- orchestrator integration notes
```

## Worker 4 Prompt: Relay And External Endpoint Path

```text
You are Worker 4 for the Discovery Setup Wizard project in the Job-Bored repo.

Read these docs first:
- /Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-SPEC.md
- /Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md

Shared rules:
- You are not alone in the codebase. Other workers may be editing nearby files.
- Do not revert changes you did not make.
- Stay inside your assigned write scope.
- Read any file you need, but only edit files you own.
- If your task requires an app.js or index.html change, do not make it. Leave a clear integration note for the orchestrator.
- Preserve the BYO/static architecture.
- Preserve the rule that stub wiring is never equivalent to real discovery readiness.
- Report exactly which files you changed and any orchestrator follow-ups.

Your purpose:
- handle browser-facing public endpoint setup after the real engine is chosen

Your write scope:
- /Users/emilionunezgarcia/Job-Bored/discovery-wizard-relay.js
- /Users/emilionunezgarcia/Job-Bored/scripts/deploy-cloudflare-relay.mjs
- /Users/emilionunezgarcia/Job-Bored/templates/cloudflare-worker/README.md

Read-only context:
- /Users/emilionunezgarcia/Job-Bored/app.js
- /Users/emilionunezgarcia/Job-Bored/index.html

Build:
- wizard actions for Worker relay deployment
- external HTTPS endpoint validation path
- Worker URL apply helpers
- Cloudflare auth/subdomain remediation helpers
- classification for incorrect endpoint types:
  - local-only URL on hosted dashboard
  - Worker /forward
  - managed Apps Script stub pretending to be real

Constraints:
- do not implement local bootstrap/ngrok logic
- do not implement shared verification semantics
- do not edit app.js or index.html

Important product rules:
- Worker URL is the browser-facing URL saved in JobBored
- ngrok/public target is downstream only
- Apps Script stub can be used for smoke tests but never marked real-ready

Deliver:
- relay/external-endpoint code in your owned files
- a short integration note for the orchestrator explaining:
  - exported actions
  - expected inputs from readinessSnapshot
  - any deploy-script behavior changes the wizard depends on

At the end, list:
- files changed
- exported APIs
- orchestrator integration notes
```

## Worker 5 Prompt: Verification And QA

```text
You are Worker 5 for the Discovery Setup Wizard project in the Job-Bored repo.

Read these docs first:
- /Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-SPEC.md
- /Users/emilionunezgarcia/Job-Bored/docs/DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md

Shared rules:
- You are not alone in the codebase. Other workers may be editing nearby files.
- Do not revert changes you did not make.
- Stay inside your assigned write scope.
- Read any file you need, but only edit files you own.
- If your task requires an app.js or index.html change, do not make it. Leave a clear integration note for the orchestrator.
- Preserve the BYO/static architecture.
- Preserve the rule that stub wiring is never equivalent to real discovery readiness.
- Report exactly which files you changed and any orchestrator follow-ups.

Your purpose:
- unify success/failure semantics across Test webhook, wizard verification, and Run discovery
- ship the QA assets needed for greenfield testing

Your write scope:
- /Users/emilionunezgarcia/Job-Bored/discovery-wizard-verify.js
- /Users/emilionunezgarcia/Job-Bored/scripts/verify-discovery-webhook.mjs
- /Users/emilionunezgarcia/Job-Bored/docs/QA-DISCOVERY-GREENFIELD-CHECKLIST.md
- /Users/emilionunezgarcia/Job-Bored/docs/QA-DISCOVERY-LOCAL-HERMES-CHECKLIST.md

Read-only context:
- /Users/emilionunezgarcia/Job-Bored/app.js
- /Users/emilionunezgarcia/Job-Bored/index.html

Build:
- shared verificationResult helpers
- support for async 202 Accepted as a valid success mode where appropriate
- classification for:
  - stub_only
  - access protected
  - Apps Script not public
  - network/CORS failures
  - invalid endpoint
- a dedicated local-agent QA checklist
- an updated greenfield checklist aligned to the wizard

Constraints:
- do not implement shell UI
- do not implement local transport setup
- do not implement relay deploy flow
- do not edit app.js or index.html

Important product rule:
- there must not be one success model for Test webhook and another for Run discovery

Deliver:
- verification code in your owned files
- QA docs in your owned files
- a short integration note for the orchestrator explaining:
  - exported verifier APIs
  - required app.js call sites to switch over
  - any behavior changes users will notice

At the end, list:
- files changed
- exported APIs
- orchestrator integration notes
```

## Orchestrator Merge Checklist

Use this after worker outputs come back.

```text
Merge checklist:

1. Confirm no worker edited app.js or index.html directly.
2. Confirm every worker stayed inside their write scope.
3. Wire script loading for:
   - discovery-wizard-shell.js
   - discovery-wizard-probes.js
   - discovery-wizard-local.js
   - discovery-wizard-relay.js
   - discovery-wizard-verify.js
4. Integrate readinessSnapshot into Settings, empty states, and Run discovery gating.
5. Route these entry points into the wizard:
   - ?setup=discovery
   - disabled Run discovery help
   - Settings setup actions
   - empty Pipeline CTA
   - Daily Brief CTA
6. Confirm Apps Script stub still cannot become connected.
7. Confirm Test webhook and Run discovery both accept async 202 Accepted consistently.
8. Demote old discovery modals from primary UX.
9. Run verification and QA.
10. Report remaining dead paths or cleanup tasks.
```
