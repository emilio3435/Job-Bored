---
name: loop-core-worker
description: Owns webhook/run core loop orchestration seams and contract-safe lifecycle behavior.
---

# Loop Core Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that touch:
- `integrations/browser-use-discovery/src/contracts.ts`
- `integrations/browser-use-discovery/src/run/run-discovery.ts`
- `integrations/browser-use-discovery/src/webhook/*`
- `integrations/browser-use-discovery/src/server.ts`

## Required Skills

None.

## Work Procedure

1. Read assigned feature, `mission.md`, `AGENTS.md`, `.factory/library/architecture.md`, and all assertion IDs in `fulfills`.
2. Write failing tests first for contract/lifecycle behavior (webhook acceptance, status polling, stage evidence, timeout semantics).
3. Implement minimal core changes to satisfy tests without changing webhook request or sheet write contracts.
4. Keep stage/telemetry evidence machine-readable for downstream validators.
5. Run targeted checks first, then full module checks:
   - `node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/*.test.ts`
   - `npm run lint:repo`
   - `npm run typecheck:repo`
6. If feature affects broad run flow, run `npm run test:browser-use-discovery` before handoff.
7. Include exact evidence for every fulfilled assertion in handoff.

## Example Handoff

```json
{
  "salientSummary": "Added explicit loop stage evidence to run status payload and hardened async timeout terminalization behavior without changing webhook request shape.",
  "whatWasImplemented": "Updated run-discovery lifecycle emission and status-store serialization so scout/score/exploit/learn stage transitions are machine-readable, added 404 coverage for unknown run status lookups, and ensured timeout force-terminalization records reason attribution.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/handle-discovery-webhook.test.ts integrations/browser-use-discovery/tests/webhook/cross-area-flows.test.ts",
        "exitCode": 0,
        "observation": "Webhook ack/status contract and timeout behavior passed."
      },
      {
        "command": "npm run lint:repo && npm run typecheck:repo",
        "exitCode": 0,
        "observation": "Repo-level lint/typecheck passed."
      }
    ],
    "interactiveChecks": [
      {
        "action": "POSTed local /webhook and polled /runs/{runId} to terminal.",
        "observed": "runId lineage stayed consistent and stage-order evidence was present in terminal payload."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "integrations/browser-use-discovery/tests/webhook/cross-area-flows.test.ts",
        "cases": [
          {
            "name": "emits scout-score-exploit-learn stage evidence in monotonic order",
            "verifies": "Core loop lifecycle ordering is machine-verifiable."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature requires changing webhook request contract or sheet output contract.
- Required assertion depends on external credential/relay state not available.
- Stage-order telemetry cannot be made observable without broader architecture change outside assigned scope.
