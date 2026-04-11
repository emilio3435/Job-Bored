---
name: integration-refactor-worker
description: Refactor discovery, scraper, ATS, contract, and test infrastructure with contract-first verification.
---

# Integration Refactor Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use for features that primarily touch:
- `server/`
- `integrations/browser-use-discovery/`
- `schemas/`, `examples/`, contract scripts, and validation wiring
- browser-to-service integration seams such as discovery POSTs, scraper, ATS, and starter-sheet or sheet-write contracts

## Required Skills

- `agent-browser` — invoke when the feature changes a browser-visible integration path and the fulfilled assertions require browser-side verification.

## Work Procedure

1. Read the assigned feature, `mission.md`, `AGENTS.md`, `.factory/library/architecture.md`, `.factory/library/contracts.md`, and the specific validation assertions the feature fulfills.
2. Trace the contract boundary before editing:
   - request/response schema
   - config/env expectations
   - downstream persistence effects
3. Add or update failing automated tests first:
   - endpoint/unit/integration tests for the touched behavior
   - contract fixtures when needed
4. Implement the smallest change that makes the tests pass while preserving contract shape unless the feature explicitly changes it.
5. Run targeted checks during iteration:
   - relevant contract test script(s)
   - targeted discovery or ATS tests
   - syntax/static checks for touched files
6. Verify end-to-end behavior on the real local surface:
   - use `curl` for HTTP/service assertions
   - use `agent-browser` if the change is user-visible in the dashboard
   - for worker-only discovery behavior with no meaningful browser signal, seeded sheet readback or other deterministic contract evidence may substitute for browser automation
   - collect evidence for async discovery runs if the contract requires eventual completion, not just acceptance
7. Run validators from `.factory/services.yaml` before ending the feature:
   - `typecheck`
   - `lint`
   - relevant targeted tests, then the full `test` command when the feature is ready
8. Stop any processes you started and return a precise handoff.

## Example Handoff

```json
{
  "salientSummary": "Fixed the ATS server's malformed-response handling so valid requests return structured scorecards again, added regression tests around the error parser, and verified the live local endpoint with the example request payload.",
  "whatWasImplemented": "Refactored the ATS transport parsing path in server/index.mjs and server/ats-scorecard.mjs, added deterministic tests for malformed upstream content and valid structured responses, and kept the browser/request contract unchanged.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "npm run test:ats-contract",
        "exitCode": 0,
        "observation": "ATS request/response fixtures still matched the published schema."
      },
      {
        "command": "node --test integrations/browser-use-discovery/tests/webhook/*.test.ts",
        "exitCode": 0,
        "observation": "Related webhook contract tests remained green."
      },
      {
        "command": "curl -sS -X POST http://127.0.0.1:3847/api/ats-scorecard -H 'Content-Type: application/json' --data @examples/ats-scorecard-request.v1.json",
        "exitCode": 0,
        "observation": "Endpoint returned 200 with a structured ATS scorecard payload."
      },
      {
        "command": "npm run test:contract:all && node --test tests/*.test.mjs && npm run test:browser-use-discovery",
        "exitCode": 0,
        "observation": "Full repo validation passed after the change."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened the draft modal in the browser and triggered ATS analysis after a successful draft generation.",
        "observed": "The ATS card moved from loading to success and rendered the same fields returned by the local endpoint."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "server/tests/ats-response-parsing.test.mjs",
        "cases": [
          {
            "name": "valid ATS provider response maps to scorecard payload",
            "verifies": "The happy path preserves the existing browser/server contract."
          },
          {
            "name": "malformed provider output becomes actionable ATS error",
            "verifies": "Upstream parsing failures no longer surface as opaque 502s."
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "medium",
      "description": "ATS webhook mode still lacks a deterministic local fixture receiver for payload-parity testing.",
      "suggestedFix": "Add a webhook transport test harness in the guardrails milestone so server and webhook parity can be validated without external flakiness."
    }
  ]
}
```

## Approved Mission Exceptions

The following behaviors are **expected and approved** in this mission and should NOT be reported as deviations:

### Dirty-Baseline Preservation

This mission deliberately started with an intentionally dirty baseline (many uncommitted changes). Workers should:
- **NOT clean up unrelated uncommitted changes** — they belong to other workers or represent the intentional baseline state
- **Stage surgically** using `git add -p` to commit only feature-specific changes
- **Preserve the dirty baseline** for other workers working from the same worktree

### Temporary Verification-Port Fallback

When canonical mission ports are occupied by other active sessions:
- **Start services on temporary ports** when canonical ports (8080, 3847, 8644) are in use by other sessions
- **Document the fallback** in the handoff: which port was used and why canonical port ownership was unsafe to reuse
- **Verify provenance**: confirm the temporary service was started from the active worktree, not an external process

See `.factory/library/refactoring.md` for the full temporary-port-fallback strategy including provenance checks.

### Port Allocation Reference

| Service | Canonical Port | Fallback Pattern |
|---------|---------------|-----------------|
| Dashboard/dev server | 8080 | `PORT=8081 npm run start:dev` |
| Local scraper/ATS | 3847 | `SCRAPER_PORT=3848 npm run start:scraper` |
| Discovery worker | 8644 | `DISCOVERY_PORT=8645 node ...` |

## When to Return to Orchestrator

- A required integration depends on credentials or external state that are unavailable or expired.
- The feature requires a contract change that would affect published schemas, examples, or docs beyond the agreed mission scope.
- The fix would need cross-cutting browser changes large enough to merit a separate frontend feature.
- Real end-to-end verification is blocked by infrastructure outside the repository.
- A port conflict exists but cannot be resolved via the temporary-port-fallback strategy (e.g., no available ports in the acceptable range).
