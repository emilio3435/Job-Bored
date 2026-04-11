---
name: refactoring
description: Codify refactor guardrails, local validation wiring, and reusable patterns from the dirty-baseline mission.
---

# Refactoring Skill

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use for features that primarily establish infrastructure guardrails, validation wiring, reusable skills, and documentation patterns based on lessons learned during the mission.

## Work Procedure

1. Read the assigned feature, `mission.md`, `AGENTS.md`, and the relevant `.factory/library/` files to understand the current state.
2. Identify the narrowest repo-infrastructure change that establishes the intended standard or guardrail.
3. Implement the guardrail without broad product-surface edits.
4. Validate at two levels:
   - direct command-level verification of the new guardrail
   - repo-level validator run from `.factory/services.yaml`
5. Stop any helper processes and produce a precise handoff.

## Dirty-Baseline Mission Context

This mission deliberately started with an intentionally dirty baseline (many uncommitted changes). The following patterns were established to handle this:

### Producing Atomic Worker Commits on Dirty Baseline

When the mission baseline starts intentionally dirty:
1. **Checkpoint first**: Create a checkpoint branch before execution begins.
2. **Stage surgically**: Use `git add -p` to stage only the specific changes needed for the current feature.
3. **Commit with clear scope**: Use the format `refactor(<scope>): <what changed>`.
4. **Preserve dirty baseline for other workers**: Do NOT clean up unrelated uncommitted changes — they belong to other workers or represent the intentional baseline state.

### Isolated Worktree Validation

When shared repo commands rely on dirty-baseline untracked files:
1. **Bootstrap explicitly**: Before running validation, copy any required baseline-only untracked files to the isolated worktree.
2. **Use the documented bootstrap path**: See `.factory/library/refactoring.md` for the isolated-worktree bootstrap strategy.
3. **Key file for discovery validation**: `integrations/browser-use-discovery/state/worker-config.json` must be bootstrapped for `test:browser-use-discovery` to run in clean worktrees.

### Missing User-Testing Synthesis Artifacts

When a prior user-testing synthesis artifact is missing:
1. **Do not block on missing synthesis**: Continue with the feature work using available evidence.
2. **Update mission-directory state outside the repo**: Synthesis artifacts belong to the validation directory, not necessarily committed to the repo.
3. **Rerun selectors**: Use the latest available synthesis to determine which assertions still need verification.
4. **Document the gap**: Note the missing artifact in the handoff so future workers can reason about it.

## Example Handoff

```json
{
  "salientSummary": "Established guardrail infrastructure for the dirty-baseline mission, including a refactoring skill, isolated-worktree bootstrap strategy, and documentation for validation edge cases.",
  "whatWasImplemented": "Created refactoring skill, documented dirty-baseline commit patterns, isolated-worktree validation strategy, temporary verification-port fallback, and Apps Script classification integration check.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "npm run lint:skills",
        "exitCode": 0,
        "observation": "New refactoring skill passed lint check."
      },
      {
        "command": "sh .factory/init.sh",
        "exitCode": 0,
        "observation": "Init script was idempotent and completed without unexpected changes."
      },
      {
        "command": "npm run test:contract:all",
        "exitCode": 0,
        "observation": "Contract tests remained green after guardrail additions."
      }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [],
    "coverage": "Guardrail documentation and skills, not product code."
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The requested guardrail would require changing user-facing behavior beyond the agreed mission scope.
- A hook or automation step depends on external tools or accounts that are not present in the environment.
- The feature reveals a broader architectural issue that should become its own refactor milestone.
