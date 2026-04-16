---
name: loop-ats-worker
description: Implements ATS scout/exploit frontier behavior and ATS-lane resilience.
---

# Loop ATS Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that touch:
- `integrations/browser-use-discovery/src/browser/providers/**`
- `integrations/browser-use-discovery/src/browser/source-adapters.ts`
- ATS-specific paths in `integrations/browser-use-discovery/src/run/run-discovery.ts`
- ATS-focused tests under `integrations/browser-use-discovery/tests/browser/*` and `tests/webhook/*`

## Required Skills

None.

## Work Procedure

1. Read assigned feature, ATS assertions in `validation-contract.md`, and current ATS tests.
2. Add failing ATS tests first (seed provenance, scout lightweight behavior, exploit gating, timeout resilience).
3. Implement ATS changes while preserving preset routing and contract boundaries.
4. Keep ATS scout lightweight; avoid introducing full normalization in scout paths.
5. Validate resilience cases (provider timeout/hang and no-post-collection stall).
6. Run:
   - `node --experimental-strip-types --test integrations/browser-use-discovery/tests/browser/source-adapters.test.ts integrations/browser-use-discovery/tests/browser/source-adapters-ats-first.test.ts`
   - relevant webhook regression tests for ATS behavior.
7. Document seed provenance and gating evidence in handoff.

## Example Handoff

```json
{
  "salientSummary": "Implemented ATS scout frontier assembly from configured+memory channels and added exploit-target gating under shared budget, including timeout isolation coverage.",
  "whatWasImplemented": "Refactored ATS lane to emit lightweight scout observations before exploit, added seed sufficiency fallback rules, and ensured provider timeout branches continue lifecycle progression without hanging the run.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "node --experimental-strip-types --test integrations/browser-use-discovery/tests/browser/source-adapters.test.ts integrations/browser-use-discovery/tests/browser/source-adapters-ats-first.test.ts",
        "exitCode": 0,
        "observation": "ATS surface detect/list behavior and timeout isolation passed."
      },
      {
        "command": "node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts",
        "exitCode": 0,
        "observation": "ATS run flow remained stable with no post-collection stall."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Executed an ats_only webhook run and inspected source summary.",
        "observed": "ATS scout/exploit counters were present and run reached terminal state."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts",
        "cases": [
          {
            "name": "ATS fallback host search only runs when seed sufficiency fails",
            "verifies": "ATS seed fallback policy is enforced."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- ATS assertion requires non-ATS module edits outside assigned write scope.
- Provider integration requires credentials or external runtime setup unavailable in workspace.
- Shared-budget contract cannot be satisfied without scoring-layer feature landing first.
