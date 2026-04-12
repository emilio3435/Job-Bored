---
name: discovery-integration-worker
description: Implement discovery webhook contract, routing enforcement, readiness transparency, and sheet-write integrity with real-integration verification.
---

# Discovery Integration Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that primarily touch service-side discovery behavior:
- webhook parsing/auth/schema boundaries
- config resolution and preset fallback logic
- routing/execution gating across ATS and browser lanes
- run-status/readiness/log transparency
- Google Sheets write-path behavior and reconciliation

## Required Skills

- None required for coding steps.
- Use `agent-browser` only when a feature explicitly requires browser-visible verification in addition to API evidence.

## Work Procedure

1. Read assigned feature, `mission.md`, `AGENTS.md`, `.factory/library/architecture.md`, `.factory/library/contracts.md`, and fulfilled assertion IDs.
2. Trace request boundary and runtime effects before editing:
   - incoming payload contract
   - resolved lane configuration
   - per-source execution path
   - terminal run-status/write outputs
3. Add/adjust failing tests first (red):
   - webhook contract tests
   - config resolution/routing tests
   - run-status/write integrity tests
4. Implement minimal changes to pass tests (green), preserving unrelated APIs.
5. Verify routing behavior with deterministic evidence:
   - resolved config
   - source execution/non-execution proofs
   - terminal run-status output
6. Verify readiness and failure transparency surfaces (`/health`, webhook responses, `/runs/{runId}`).
7. Run validators from `.factory/services.yaml` before handoff:
   - `typecheck`
   - `lint`
   - `test` (or targeted + full test before completion)
8. If credentials/runtime blockers prevent real end-to-end verification, return to orchestrator with precise blocker details.

## Example Handoff

```json
{
  "salientSummary": "Implemented canonical sourcePreset contract handling in webhook requests, enforced routing gates so excluded lane families are not executed, and added run-status transparency for credential/write failure paths.",
  "whatWasImplemented": "Updated discovery contract/schema to accept discoveryProfile.sourcePreset enum, added deterministic fallback mapping for omitted presets, wired resolver output into run execution gating, and added structured skip/invocation evidence plus phase-attributed write failure reporting in terminal status.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/*.test.ts",
        "exitCode": 0,
        "observation": "Webhook contract and resolver tests passed, including invalid payload branches."
      },
      {
        "command": "node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts",
        "exitCode": 0,
        "observation": "Routing truth-table and excluded-lane non-execution tests passed."
      },
      {
        "command": "npm run typecheck:repo && npm run lint:repo && npm run test:repo",
        "exitCode": 0,
        "observation": "Repository validators passed after integration updates."
      }
    ],
    "interactiveChecks": [
      {
        "action": "POSTed browser_only, ats_only, and browser_plus_ats payloads to webhook and polled /runs/{runId}.",
        "observed": "Each run produced expected lane-family execution and explicit source-level outcomes."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "integrations/browser-use-discovery/tests/webhook/source-preset-routing.test.ts",
        "cases": [
          {
            "name": "browser_only excludes ATS detect/list execution",
            "verifies": "Excluded ATS lanes have zero invocation evidence."
          },
          {
            "name": "omitted preset resolves deterministic fallback",
            "verifies": "Legacy/missing preset states map consistently."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Real-integration verification is blocked by missing/invalid credentials that cannot be fixed in repo code.
- Required behavior implies a broader contract migration beyond mission scope.
- A feature requires coordinated browser and backend changes that exceed a single feature boundary.
