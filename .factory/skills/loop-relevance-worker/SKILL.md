---
name: loop-relevance-worker
description: Enforces upstream relevance vetoes, exploit-threshold suppression, and matcher-budget routing.
---

# Loop Relevance Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that touch:
- `integrations/browser-use-discovery/src/normalize/lead-normalizer.ts`
- `integrations/browser-use-discovery/src/match/job-matcher.ts`
- relevance gating paths in `integrations/browser-use-discovery/src/grounding/grounded-search.ts`
- related tests in `integrations/browser-use-discovery/tests/sheets/*`, `tests/browser/*`, `tests/webhook/*`

## Required Skills

None.

## Work Procedure

1. Read relevance assertions and enumerate all upstream veto points before edits.
2. Add failing tests first for vetoes and suppression diagnostics.
3. Implement/strengthen upstream gates:
   - informational non-job veto,
   - employer mismatch/title-shape veto,
   - hint-only board-host veto,
   - exploit-threshold suppression.
4. Keep AI matcher budgeted and scoped per mission requirement; ensure diagnostics are explicit.
5. Run:
   - `node --experimental-strip-types --test integrations/browser-use-discovery/tests/sheets/job-matcher.test.ts integrations/browser-use-discovery/tests/sheets/lead-normalizer.test.ts integrations/browser-use-discovery/tests/browser/grounded-search.test.ts`
6. Validate that blocked candidates never reach write path.

## Example Handoff

```json
{
  "salientSummary": "Added explicit exploit-threshold suppression and tightened upstream vetoes so non-job and mismatch candidates are blocked before deep extraction.",
  "whatWasImplemented": "Updated relevance gates across preflight and matching paths, added explicit suppression diagnostics for below-threshold and hint-only vetoes, and constrained AI matcher usage to budgeted uncertainty cases per mission policy.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "node --experimental-strip-types --test integrations/browser-use-discovery/tests/sheets/lead-normalizer.test.ts integrations/browser-use-discovery/tests/sheets/job-matcher.test.ts",
        "exitCode": 0,
        "observation": "Matcher budget and normalization rejection rules passed."
      },
      {
        "command": "node --experimental-strip-types --test integrations/browser-use-discovery/tests/browser/grounded-search.test.ts",
        "exitCode": 0,
        "observation": "Preflight veto and suppression diagnostics passed."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Ran a mixed webhook flow containing informational and hint-only URLs.",
        "observed": "Blocked URLs produced suppression diagnostics and never reached write payload."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "integrations/browser-use-discovery/tests/browser/grounded-search.test.ts",
        "cases": [
          {
            "name": "below-threshold candidates emit suppression diagnostics and are not extracted",
            "verifies": "Exploit-threshold gate works before deep extraction."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Relevance requirements conflict with canonical-write contract or expected recall/precision policy.
- Needed suppression reason taxonomy requires broader telemetry/schema decisions.
