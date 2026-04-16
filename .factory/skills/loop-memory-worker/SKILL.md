---
name: loop-memory-worker
description: Implements scout/exploit memory persistence, yield history, cooldown, and deterministic role-family learning.
---

# Loop Memory Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that touch:
- `integrations/browser-use-discovery/src/state/discovery-memory-store.ts`
- persistence paths in `integrations/browser-use-discovery/src/run/run-discovery.ts`
- memory-related tests under `integrations/browser-use-discovery/tests/state/*` and `tests/browser/*`

## Required Skills

None.

## Work Procedure

1. Read memory assertions and verify required tables/entities before coding.
2. Write failing tests first for schema changes and run-persistence side effects.
3. Implement persistence for scout observations, exploit outcomes, and role-family memory with deterministic updates.
4. Ensure stored success/failure and lane/company attribution are truthful (no over-reporting success).
5. Wire memory readback into future seeding/ranking/cooldown behavior.
6. Run:
   - `node --experimental-strip-types --test integrations/browser-use-discovery/tests/state/discovery-memory-store.test.ts integrations/browser-use-discovery/tests/browser/discovery-memory-store.test.ts integrations/browser-use-discovery/tests/discovery/company-planner.test.ts`
7. Add migration-safe handling for existing SQLite state where needed.

## Example Handoff

```json
{
  "salientSummary": "Added scout/exploit memory entities and deterministic role-family persistence, then wired readback signals into ranking and cooldown logic.",
  "whatWasImplemented": "Extended discovery-memory-store schema for surface observations and yield history, added truthful run persistence for per-company success/failure attribution, and introduced deterministic role-family pattern updates consumed by subsequent seed/score flows.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "node --experimental-strip-types --test integrations/browser-use-discovery/tests/state/discovery-memory-store.test.ts integrations/browser-use-discovery/tests/browser/discovery-memory-store.test.ts",
        "exitCode": 0,
        "observation": "Schema migrations and persistence/readback behavior passed."
      },
      {
        "command": "node --experimental-strip-types --test integrations/browser-use-discovery/tests/discovery/company-planner.test.ts",
        "exitCode": 0,
        "observation": "Memory-informed ranking/cooldown behavior passed."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Ran two sequential discovery runs with same intent and inspected second-run seed/score shifts.",
        "observed": "Second run reflected persisted yield/cooldown/role-family memory influence."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "integrations/browser-use-discovery/tests/state/discovery-memory-store.test.ts",
        "cases": [
          {
            "name": "persists scout observations and exploit outcomes with run/surface linkage",
            "verifies": "Learn-phase artifacts are queryable and attributable."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Migration requires destructive reset of user state DB.
- Memory changes require cross-module contract edits outside mission scope.
