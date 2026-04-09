# Documentation index

Pointers to contract, setup, automation roadmap, hardening notes, and machine-readable artifacts.

## Core docs

| Document                                                                                                                 | Description                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [AGENT_CONTRACT.md](../AGENT_CONTRACT.md)                                                                                | Machine-oriented contract: Pipeline sheet shape (A) and optional discovery webhook POST (B).                             |
| [AUTOMATION_PLAN.md](../AUTOMATION_PLAN.md)                                                                              | Maintainer-facing phased roadmap for BYO discovery automation (static OSS, no maintainer hosting).                       |
| [SETUP.md](../SETUP.md)                                                                                                  | End-user setup: Sheets, OAuth, write-back, and links to BYO automation templates.                                        |
| [DISCOVERY-PATHS.md](./DISCOVERY-PATHS.md)                                                                               | Discovery options: webhooks vs scheduled jobs vs manual Pipeline — diagrams and links.                                   |
| [DISCOVERY-SETUP-WIZARD-SPEC.md](./DISCOVERY-SETUP-WIZARD-SPEC.md)                                                       | Product spec for replacing the manual discovery setup flow with one guided wizard and orchestrated build plan.           |
| [DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md](./DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md)                         | Master-orchestrator build plan with concrete file ownership, worker lanes, integration points, and merge rules.          |
| [DISCOVERY-SETUP-WIZARD-WORKER-PROMPTS.md](./DISCOVERY-SETUP-WIZARD-WORKER-PROMPTS.md)                                   | Copy-paste prompts for the master orchestrator and each worker lane in the discovery wizard swarm.                       |
| [SETTINGS-TABS-WORKER-PROMPTS.md](./SETTINGS-TABS-WORKER-PROMPTS.md)                                                     | Copy-paste prompts for the master orchestrator and worker lanes to refactor Settings into real standalone tabs.          |
| [APPS-SCRIPT-DASHBOARD-DEPLOY-PLAN.md](./APPS-SCRIPT-DASHBOARD-DEPLOY-PLAN.md)                                           | Concrete implementation plan for in-dashboard Apps Script stub deploy via incremental OAuth.                             |
| [QA-SETTINGS-TABS-CHECKLIST.md](./QA-SETTINGS-TABS-CHECKLIST.md)                                                         | Manual regression and QA checklist for the settings anchor-nav → real-tabs refactor.                                     |
| [QA-DISCOVERY-GREENFIELD-CHECKLIST.md](./QA-DISCOVERY-GREENFIELD-CHECKLIST.md)                                           | End-to-end QA checklist for a clean-user setup of Apps Script deploy, Cloudflare relay, and webhook test.                |
| [QA-DISCOVERY-LOCAL-HERMES-CHECKLIST.md](./QA-DISCOVERY-LOCAL-HERMES-CHECKLIST.md)                                       | QA checklist for the localhost Hermes/OpenClaw discovery path, including bootstrap, ngrok, relay, and verification.      |
| [planning-handoffs/HANDOFF-APPS-SCRIPT-DASHBOARD-DEPLOY.md](./planning-handoffs/HANDOFF-APPS-SCRIPT-DASHBOARD-DEPLOY.md) | Handoff for planning: deploy Apps Script stub from dashboard via incremental OAuth (future).                             |
| [planning-handoffs/HANDOFF-RUN-DISCOVERY-REAL-JOBS.md](./planning-handoffs/HANDOFF-RUN-DISCOVERY-REAL-JOBS.md)           | Handoff for planning/implementation: make `Run discovery` produce real Pipeline rows or explicitly block stub-only mode. |
| [SECURITY.md](../SECURITY.md)                                                                                            | Where tokens and settings live; leak response notes for maintainers.                                                     |
| [CONTRACT-HARDENING-PLAN.md](CONTRACT-HARDENING-PLAN.md)                                                                 | Plan to keep the agent–dashboard contract versioned, testable, and aligned with schema and integrations.                 |
| [CONTRACT-CHANGELOG.md](CONTRACT-CHANGELOG.md)                                                                           | Dated changes to the contract, schemas, and examples.                                                                    |
| [CONTRIBUTING.md](../CONTRIBUTING.md)                                                                                    | Contract change checklist for discovery webhook and Pipeline columns.                                                    |

## Schemas & examples

| Path                                                            | Description                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [schemas/](../schemas/)                                         | JSON Schema for webhook payloads and other machine-checkable shapes.         |
| [schemas/pipeline-row.v1.json](../schemas/pipeline-row.v1.json) | Pipeline tab column letters, header row, and UI enums (Interface A).         |
| [examples/](../examples/)                                       | Fixture JSON files for validating requests and tooling against the contract. |

## Integrations

| Document                                            | Description                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [integrations/README.md](../integrations/README.md) | Index of Apps Script, n8n, OpenClaw, and related template paths for BYOK automation. |
