# Documentation index

Pointers to contract, setup, automation roadmap, hardening notes, and machine-readable artifacts.

## Core docs

| Document                                                 | Description                                                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [AGENT_CONTRACT.md](../AGENT_CONTRACT.md)                | Machine-oriented contract: Pipeline sheet shape (A) and optional discovery webhook POST (B).             |
| [AUTOMATION_PLAN.md](../AUTOMATION_PLAN.md)              | Maintainer-facing phased roadmap for BYO discovery automation (static OSS, no maintainer hosting).       |
| [SETUP.md](../SETUP.md)                                  | End-user setup: Sheets, OAuth, write-back, and links to BYO automation templates.                        |
| [SECURITY.md](../SECURITY.md)                            | Where tokens and settings live; leak response notes for maintainers.                                     |
| [CONTRACT-HARDENING-PLAN.md](CONTRACT-HARDENING-PLAN.md) | Plan to keep the agent–dashboard contract versioned, testable, and aligned with schema and integrations. |

## Schemas & examples

| Path                      | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| [schemas/](../schemas/)   | JSON Schema for webhook payloads and other machine-checkable shapes.         |
| [examples/](../examples/) | Fixture JSON files for validating requests and tooling against the contract. |

## Integrations

| Document                                            | Description                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [integrations/README.md](../integrations/README.md) | Index of Apps Script, n8n, OpenClaw, and related template paths for BYOK automation. |
