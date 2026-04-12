# Contracts

High-level map of shared contracts that must stay aligned for browser-first discovery selection and reliability.

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
  - preset field validation and fallback semantics can drift between browser payloads, schema, and worker parsing
  - async acceptance semantics can be mistaken for terminal success without explicit run-status linkage

#### Canonical preset contract (mission target)
- Request field: `discoveryProfile.sourcePreset`
- Allowed values:
  - `browser_only`
  - `ats_only`
  - `browser_plus_ats`
- Run intent is request-authoritative (no silent stored-profile fallback for omitted discovery-intent fields).
- Minimum required discovery intent for run dispatch/acceptance:
  - explicit `discoveryProfile.sourcePreset`
  - at least one non-empty value in `discoveryProfile.targetRoles` or `discoveryProfile.keywordsInclude`
- Browser UI bridge rule:
  - AI Suggest output may originate in non-canonical UI fields, but run dispatch must promote resolved values into canonical `discoveryProfile.targetRoles` / `discoveryProfile.keywordsInclude` before webhook submission.
- Company scope rule:
  - Discovery execution must support unrestricted scope when worker config has an empty `companies` array; this is not a preflight contract failure by itself.
  - Source preset routing semantics remain authoritative in unrestricted scope (`browser_only`, `ats_only`, `browser_plus_ats`).
- Grounded query composition rule (unrestricted scope):
  - When `companies` scope is empty, grounded search queries must be composed from explicit intent modifiers (`targetRoles`, `keywordsInclude`, `locations`, remote/seniority inputs) and must not rely on placeholder company labels.
- Optional transient field: `googleAccessToken` (runtime passthrough only; never persisted)
- Invalid/contradictory values must return explicit `400` errors.
- Async acceptance must include `runId`, `statusPath`, and `pollAfterMs`.

#### accepted_async polling metadata field name variants

The `accepted_async` webhook response may use either `statusPath` (camelCase) or `status_path` (snake_case) as the key for the polling endpoint, depending on whether the response traveled through the direct worker path or the relay path. Browser-side polling code must handle both:

```javascript
// Example from app.js line 5061
const statusPath = String(result.statusPath || result.status_path || "").trim();
```

**Why:** The discovery wizard relay (Cloudflare worker) may forward the response with snake_case keys while the direct worker path uses camelCase. Browser-side polling code must be tolerant of both forms.

### ATS scorecard contract
- Primary references:
  - `schemas/ats-scorecard-request.v1.schema.json`
  - `schemas/ats-scorecard-response.v1.schema.json`
  - `examples/ats-scorecard-*.json`
  - browser ATS request builder
  - local ATS server / webhook transport
- Mission risk:
  - transport normalization and server/webhook parity can drift independently of the UI
  - `npm run test:ats-contract` now validates both ATS example fixtures and live `app.js` ATS request-builder payloads against the v1 request schema; when request transport or normalization changes, still review the server/webhook normalization path alongside the contract guard

## Validation scripts that guard contract drift

- `npm run test:contract`
- `npm run test:ats-contract`
- `npm run test:pipeline-contract`
- `npm run test:contract:all`
- `npm run test:browser-use-discovery`

## Worker guidance

- When changing any contract-bearing surface, update the implementation and its contract references together.
- If behavior must change intentionally, treat it as an explicit scope change and return to orchestrator rather than silently changing the contract.
- For source-selection work, keep request schema, worker contracts, and run-status evidence fields aligned in the same feature set.
