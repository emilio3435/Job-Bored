---
name: loop-scoring-worker
description: Builds shared frontier scoring and exploit target selection under exploration budgets.
---

# Loop Scoring Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that touch:
- `integrations/browser-use-discovery/src/discovery/company-planner.ts`
- shared selection logic in `integrations/browser-use-discovery/src/run/run-discovery.ts`
- scoring/selection tests under `integrations/browser-use-discovery/tests/discovery/*` and `tests/webhook/*`

## Required Skills

None.

## Work Procedure

1. Read scoring assertions and current score component behavior before editing.
2. Add failing tests first for shared frontier composition and deterministic exploit target selection.
3. Implement shared ATS+browser frontier ranking with explicit score components and penalties.
4. Implement/extend shared exploration budgets (`maxScoutSurfaces`, `maxExploitSurfaces`, `maxScoutListingsPerSurface`) and enforce pre-extraction.
5. Ensure deep extraction dispatch is restricted to selected exploit targets only.
6. Run:
   - `node --experimental-strip-types --test integrations/browser-use-discovery/tests/discovery/company-planner.test.ts integrations/browser-use-discovery/tests/browser/company-planner.test.ts integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts`
7. Include deterministic repeatability evidence for fixed-input selection.

## Example Handoff

```json
{
  "salientSummary": "Implemented shared ATS/browser scoring frontier and pre-extraction exploit target selection with enforced scout/exploit budget caps.",
  "whatWasImplemented": "Refactored selection flow so ATS and browser opportunities are scored under one schema, added deterministic exploit target ordering and budget guards, and ensured only selected targets can trigger deep extraction.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "node --experimental-strip-types --test integrations/browser-use-discovery/tests/discovery/company-planner.test.ts integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts",
        "exitCode": 0,
        "observation": "Scoring components, deterministic ordering, and budget enforcement passed."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Executed repeated mixed runs with fixed fixtures.",
        "observed": "Exploit target IDs/order remained stable and selected count respected configured budget."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts",
        "cases": [
          {
            "name": "deep extraction only executes for selected exploit targets",
            "verifies": "Selection gate is enforced before extraction."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Budget semantics conflict with mission requirements or require changing user-approved defaults.
- Needed data signals are unavailable until memory features land.
