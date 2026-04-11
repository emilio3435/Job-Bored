---
name: quality-guardrail-worker
description: Add validation wiring, refactoring guardrails, mission-supporting skills, and maintenance automation without broad product changes.
---

# Quality Guardrail Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use for features that primarily touch repo infrastructure and prevention guardrails, including:
- test/lint/typecheck command wiring
- hooks, automation scripts, CI-related local config
- `.factory/library/`, `.factory/skills/`, `.factory/droids/`
- maintenance assets created to prevent future tech debt regressions

## Required Skills

- `setup-browser-cookies` — invoke when a validation/bootstrap feature needs authenticated browser state without committing secrets.

## Work Procedure

1. Read the assigned feature, `mission.md`, `AGENTS.md`, and the relevant `.factory/library/` files.
2. Define the narrowest repo-infrastructure change that enforces or preserves the intended standard.
   - If the feature requires separating or reverting a change set, perform that disposition directly; do not close with documentation-only notes unless the feature explicitly permits it.
3. Add or update failing tests/checks first when guardrails are executable.
4. Implement the guardrail without broad product-surface edits.
5. Validate at two levels:
   - direct command-level verification of the new guardrail
   - execute every edited command snippet exactly as written (droids, skills, hooks, docs) and capture stdout/stderr evidence
   - repo-level validator run from `.factory/services.yaml`
   - if the feature depends on authenticated browser state, use the approved browser-cookie import path before manual verification
6. If the feature creates reusable mission assets (skills, droids, hook config), make sure names, paths, and usage guidance are internally consistent.
7. Stop any helper processes and produce a precise handoff that makes follow-up maintenance obvious.

## Example Handoff

```json
{
  "salientSummary": "Added reusable refactoring guardrails under .factory, including a maintenance skill and local validation wiring, then verified the new command surface and repo validators.",
  "whatWasImplemented": "Created a focused refactoring skill, added maintenance droid definitions, and tightened the local validation command surface so future workers can run the correct contract, root, and discovery checks from one place.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "npm run lint:skills",
        "exitCode": 0,
        "observation": "Skill references remained valid after the new .factory assets were added."
      },
      {
        "command": "sh .factory/init.sh",
        "exitCode": 0,
        "observation": "The init script was idempotent and completed without modifying source code unexpectedly."
      },
      {
        "command": "npm run test:contract:all && node --test tests/*.test.mjs && npm run test:browser-use-discovery",
        "exitCode": 0,
        "observation": "Repo validation stayed green after the guardrail changes."
      }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "scripts/test-contract.mjs",
        "cases": [
          {
            "name": "published examples and schemas stay aligned",
            "verifies": "Contract drift is caught before future refactors land."
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "low",
      "description": "The repo still lacks a first-class TypeScript typecheck for the Browser Use worker and currently relies on runtime tests plus syntax checks.",
      "suggestedFix": "Track a follow-up guardrail feature if the mission decides to introduce a dedicated typecheck surface."
    }
  ]
}
```

## When to Return to Orchestrator

- The requested guardrail would require changing user-facing behavior beyond the agreed mission scope.
- A hook or automation step depends on external tools or accounts that are not present in the environment.
- The feature reveals a broader architectural issue that should become its own refactor milestone.
