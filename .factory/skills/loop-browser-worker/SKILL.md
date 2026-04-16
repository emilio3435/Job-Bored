---
name: loop-browser-worker
description: Implements browser canonical scout behavior, hint resolution, and canonical exploit gating.
---

# Loop Browser Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that touch:
- `integrations/browser-use-discovery/src/grounding/grounded-search.ts`
- `integrations/browser-use-discovery/src/discovery/career-surface-resolver.ts`
- Browser canonical scout tests under `integrations/browser-use-discovery/tests/browser/*`

## Required Skills

None.

## Work Procedure

1. Read browser-canonical assertions in `validation-contract.md` and related existing tests.
2. Write failing tests first for:
   - policy classification,
   - hint-only suppression,
   - canonical resolution success/failure,
   - canonical-only exploit admission.
3. Implement canonical gate behavior so non-canonical candidates cannot be directly exploited.
4. Ensure careers/listings seed expansion captures embedded ATS/sitemap/schema/direct job evidence.
5. Keep diagnostics explicit (`hint_only_candidate`, `canonical_surface_resolved`, `canonical_surface_extracted`, suppression reasons).
6. Run:
   - `node --experimental-strip-types --test integrations/browser-use-discovery/tests/browser/grounded-search.test.ts integrations/browser-use-discovery/tests/browser/grounded-search-ats-first.test.ts integrations/browser-use-discovery/tests/browser/career-surface-resolver.test.ts`
7. Provide URL-attributed evidence in handoff.

## Example Handoff

```json
{
  "salientSummary": "Hardened browser scout to enforce canonical-only exploit admission and expanded careers/listings seed discovery for embedded ATS and schema/sitemap signals.",
  "whatWasImplemented": "Added deterministic policy classification updates, filtered non-canonical resolved candidates before exploit, and extended preflight-approved seed expansion so embedded ATS links become exploitable canonical targets with explicit diagnostics.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "node --experimental-strip-types --test integrations/browser-use-discovery/tests/browser/career-surface-resolver.test.ts integrations/browser-use-discovery/tests/browser/grounded-search.test.ts integrations/browser-use-discovery/tests/browser/grounded-search-ats-first.test.ts",
        "exitCode": 0,
        "observation": "Canonical classification, hint handling, and extraction gating scenarios passed."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Ran a browser_only webhook run with known third-party hints and canonical ATS pages.",
        "observed": "Third-party hints were blocked from direct extraction and canonical surfaces produced extraction diagnostics."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "integrations/browser-use-discovery/tests/browser/grounded-search.test.ts",
        "cases": [
          {
            "name": "resolved extractable-but-non-canonical host is suppressed before exploit",
            "verifies": "Canonical-only exploit gate is enforced."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Required behavior implies webhook or sheet contract changes.
- Public web restrictions or external host behaviors block deterministic validation and need user decision.
