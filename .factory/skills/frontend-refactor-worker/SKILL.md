---
name: frontend-refactor-worker
description: Refactor browser-facing dashboard, settings, onboarding, and draft flows with test-first discipline and browser verification.
---

# Frontend Refactor Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use for features that primarily touch browser-facing code in the repo root, including:
- `app.js`, `index.html`, `style.css`
- settings, dashboard, drawer, onboarding, profile, draft generation UI
- browser-side discovery flows and browser config persistence

## Required Skills

- `agent-browser` — use for any feature that changes user-visible browser behavior or fulfills browser assertions in the validation contract.

## Work Procedure

1. Read the assigned feature, `mission.md`, `AGENTS.md`, `.factory/library/architecture.md`, and the relevant validation assertions it fulfills.
2. Identify the smallest browser-facing seam you can change without broad rewrite.
3. Write or update targeted failing tests first when the touched logic has or should have automated coverage.
4. Implement the minimum refactor or fix needed to make those tests pass while preserving public behavior.
5. Run targeted validation during iteration:
   - the smallest relevant automated test command(s)
   - any syntax/static check needed for touched JS files
6. Verify the exact user flows with `agent-browser` on the local app:
   - capture the user journey you changed
   - check for console errors
   - confirm the fulfilled assertions from the contract are actually observable
7. Run repo validators from `.factory/services.yaml` before ending the feature:
   - `typecheck`
   - `lint`
   - relevant test commands, then the full `test` command when the feature is ready
8. Stop any processes you started and produce a precise handoff.

## Example Handoff

```json
{
  "salientSummary": "Refactored dashboard drawer status handling into smaller helpers without changing the board UX. Added targeted tests for status side effects, verified the drawer save flow in the browser, and reran the repo validators.",
  "whatWasImplemented": "Split the status-save path out of app.js into focused helper functions, updated the drawer refresh logic so the active role stays attached after save, and added regression coverage for status-driven lane movement and overdue follow-up signaling.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "node --test tests/recovery-state.test.mjs",
        "exitCode": 0,
        "observation": "Existing recovery-state tests still passed after the refactor."
      },
      {
        "command": "node --check app.js",
        "exitCode": 0,
        "observation": "Browser entrypoint remained syntactically valid."
      },
      {
        "command": "npm run test:contract:all && node --test tests/*.test.mjs && npm run test:browser-use-discovery",
        "exitCode": 0,
        "observation": "Repo validators passed after the change set."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened http://localhost:8080, opened a role drawer, changed status to Applied, saved, and confirmed the role moved to the Applied lane.",
        "observed": "Drawer stayed bound to the same role, lane placement updated correctly, and no console errors appeared."
      },
      {
        "action": "Edited a follow-up date to an overdue value in the drawer and saved.",
        "observed": "The overdue signal updated on the dashboard without requiring a manual reload."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "tests/dashboard-status-sync.test.mjs",
        "cases": [
          {
            "name": "status save keeps active drawer role in sync",
            "verifies": "The active drawer remains attached to the same role after a status-triggered refresh."
          },
          {
            "name": "applied transition backfills expected CRM dates",
            "verifies": "Status helpers preserve the documented side effects for Applied transitions."
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "medium",
      "description": "Daily Brief activity-range interactions still rely on a broad render function and remain a likely regression point during future UI decomposition.",
      "suggestedFix": "Track this under the frontend decomposition milestone and extract the activity widget into a narrower rendering unit."
    }
  ]
}
```

## When to Return to Orchestrator

- The feature requires a sheet/auth/provider decision that is not encoded in mission state.
- A browser assertion cannot be validated because credentials, seeded data, or local services are unavailable.
- The refactor would require rewriting large browser surfaces instead of making an incremental extraction.
- The feature exposes a broader contract drift that should become its own follow-up feature.
