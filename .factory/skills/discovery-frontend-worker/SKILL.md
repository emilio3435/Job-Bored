---
name: discovery-frontend-worker
description: Implement browser-side discovery preset UX, run-status visibility, and persistence with contract-aligned verification.
---

# Discovery Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that primarily touch browser-facing discovery behavior:
- preset controls and persistence in `app.js`, `index.html`, `user-content-store.js`
- run initiation feedback and async status visibility in the dashboard
- browser-side request payload composition for discovery runs

## Required Skills

- `agent-browser` — required for validating user-visible preset selection and run-status behavior.

## Work Procedure

1. Read the assigned feature, `mission.md`, `AGENTS.md`, `.factory/library/architecture.md`, and all assertion IDs in `fulfills`.
2. Identify existing browser state and payload seams before coding:
   - active preset storage
   - run trigger payload builder
   - run-status UI state transitions
3. Add or update failing tests first (red) for the changed behavior.
   - If a suitable automated test already exists, extend it to fail first and then pass.
   - If no practical automated seam exists for a UI-only change, document that limitation explicitly in handoff and rely on stronger browser evidence.
4. Implement the minimal UI/state change to make tests pass (green) while preserving unrelated dashboard behavior.
5. Run targeted checks while iterating:
   - syntax/type checks for touched files
   - targeted tests for changed logic
6. Verify fulfilled assertions with `agent-browser` (required for UI assertions; server-side tests are supplementary, not a substitute):
   - preset behavior
   - run handle visibility
   - async/terminal transition behavior
7. Run repository validators from `.factory/services.yaml` before handoff:
   - `typecheck`
   - `lint`
   - `test` (or a feature-scoped subset first, then full test before completion)
8. Stop any started processes and return a detailed handoff with command outputs and browser observations.

## Example Handoff

```json
{
  "salientSummary": "Implemented discovery source preset UI with mutually exclusive Browser-only/ATS-only/Browser+ATS controls, persisted selection, and updated run-status rendering so accepted_async never appears as terminal success.",
  "whatWasImplemented": "Added preset selector wiring in app.js/index.html, normalized legacy saved discovery state into explicit presets, updated run-start feedback to include runId/statusPath, and added async polling error handling that surfaces actionable non-success UI states.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "node --check app.js && node --check user-content-store.js",
        "exitCode": 0,
        "observation": "Updated browser scripts remained syntactically valid."
      },
      {
        "command": "node --test tests/discovery-preset-ui.test.mjs",
        "exitCode": 0,
        "observation": "Preset persistence and payload selection regressions are covered."
      },
      {
        "command": "npm run typecheck:repo && npm run lint:repo && npm run test:repo",
        "exitCode": 0,
        "observation": "Repository validators passed after frontend changes."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened dashboard, switched presets quickly, clicked Run discovery, and inspected outbound request payload.",
        "observed": "Submitted sourcePreset matched the last selected preset."
      },
      {
        "action": "Triggered accepted_async run and observed status transitions to terminal partial/failure path.",
        "observed": "UI moved from pending/running to explicit non-success state for the same runId."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "tests/discovery-preset-ui.test.mjs",
        "cases": [
          {
            "name": "last selected preset is submitted",
            "verifies": "Run payload uses final UI selection at submit time."
          },
          {
            "name": "legacy state normalizes to explicit preset",
            "verifies": "First-load and legacy storage states resolve deterministically."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Required browser verification cannot run due to missing local services or blocked auth state.
- Feature needs cross-cutting backend contract changes beyond assigned scope.
- Validation assertion behavior is ambiguous or conflicts with current mission contract.
