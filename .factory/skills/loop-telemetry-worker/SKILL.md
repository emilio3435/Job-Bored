---
name: loop-telemetry-worker
description: Implements loop telemetry counters, failure reason attribution, and local/public regression evidence.
---

# Loop Telemetry Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that touch:
- terminal/source telemetry in `integrations/browser-use-discovery/src/run/run-discovery.ts`
- run status payload/state in `integrations/browser-use-discovery/src/contracts.ts` and `src/state/*`
- webhook/e2e telemetry tests under `integrations/browser-use-discovery/tests/webhook/*` and `tests/e2e/*`

## Required Skills

None.

## Work Procedure

1. Read telemetry and cross-area assertions before coding.
2. Add failing tests first for:
   - required loop counters,
   - counter invariants/reconciliation,
   - machine-readable failure reason attribution,
   - strict browser diagnostics propagation.
3. Implement telemetry fields and reason classification with deterministic precedence.
4. Ensure no contract drift for webhook request/sheet writes while extending status telemetry.
5. Add/maintain local + public webhook smoke evidence hooks required by validation.
6. Run:
   - `node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/ats-first-telemetry.test.ts integrations/browser-use-discovery/tests/webhook/cross-area-flows.test.ts integrations/browser-use-discovery/tests/e2e/local-qa-happy-path.test.ts`
   - plus any touched run/webhook suites.

## Example Handoff

```json
{
  "salientSummary": "Added loop counter telemetry and terminal reason attribution, then covered local/public webhook smoke lineage expectations in regression tests.",
  "whatWasImplemented": "Extended terminal run status with required scout/score/exploit counters and deterministic failure reason codes/messages, reconciled counter invariants, and added regression coverage for mixed-lane dedupe telemetry and webhook smoke lifecycle parity.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/ats-first-telemetry.test.ts integrations/browser-use-discovery/tests/webhook/cross-area-flows.test.ts",
        "exitCode": 0,
        "observation": "Required telemetry fields and cross-flow lineage assertions passed."
      },
      {
        "command": "node --experimental-strip-types --test integrations/browser-use-discovery/tests/e2e/local-qa-happy-path.test.ts",
        "exitCode": 0,
        "observation": "Local smoke contract checks passed."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Triggered local and public webhook POST smoke runs and polled run status.",
        "observed": "Both paths returned accepted_async lineage and terminal telemetry with reason attribution."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "integrations/browser-use-discovery/tests/webhook/ats-first-telemetry.test.ts",
        "cases": [
          {
            "name": "terminal degraded outcome includes reasonCode and loop counters",
            "verifies": "Explainability contract fields are present and reconcilable."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Required reason taxonomy conflicts with mission-approved behavior.
- Public relay dependency is unavailable and blocks required milestone smoke evidence.
