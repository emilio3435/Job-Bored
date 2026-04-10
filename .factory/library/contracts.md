# Contracts

High-level map of the shared contracts that must stay aligned during this refactor mission.

**What belongs here:** stable schemas, published payloads, sheet contracts, and where each contract is defined or validated.  
**What does NOT belong here:** implementation details of a single module.

---

## Core contracts

### Pipeline sheet contract
- Primary references:
  - `schemas/pipeline-row.v1.json`
  - `README.md` sheet structure
  - starter-sheet creation flow in the browser app
  - discovery worker sheet writer
- Mission risk:
  - contract drift between schema, docs, UI expectations, and discovery writes is already a known baseline problem

### Discovery webhook contract
- Primary references:
  - `AGENT_CONTRACT.md`
  - `schemas/discovery-webhook-request.v1.schema.json`
  - `examples/discovery-webhook-request.v1*.json`
  - `integrations/browser-use-discovery/src/contracts.ts`
  - `integrations/browser-use-discovery/tests/mocks/discovery-webhook-ack.accepted_async.v1.json`
  - discovery worker run-status surface in `integrations/browser-use-discovery/src/server.ts` (`/runs/{runId}`)
  - browser discovery POST path
  - worker webhook handler
- Mission risk:
  - browser verification semantics, worker acceptance semantics, and docs must remain aligned

### ATS scorecard contract
- Primary references:
  - `schemas/ats-scorecard-request.v1.schema.json`
  - `schemas/ats-scorecard-response.v1.schema.json`
  - `examples/ats-scorecard-*.json`
  - browser ATS request builder
  - local ATS server / webhook transport
- Mission risk:
  - transport normalization and server/webhook parity can drift independently of the UI
  - `npm run test:ats-contract` currently validates example fixtures only, so live browser payload builders still need direct review when ATS request-shape changes are in scope

## Validation scripts that guard contract drift

- `npm run test:contract`
- `npm run test:ats-contract`
- `npm run test:pipeline-contract`
- `npm run test:contract:all`

## Worker guidance

- When changing any contract-bearing surface, update the implementation and its contract references together.
- If behavior must change intentionally, treat it as an explicit scope change and return to orchestrator rather than silently changing the contract.
