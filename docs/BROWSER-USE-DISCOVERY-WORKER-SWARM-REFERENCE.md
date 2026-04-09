# Browser Use Discovery Worker Swarm Reference

This file is the source of truth for worker scopes, locked interfaces, merge gates, and handoff format for the Browser Use-backed discovery worker in JobBored.

Use it together with:
- `docs/BROWSER-USE-DISCOVERY-WORKER-ARCHITECTURE.md`
- `docs/BROWSER-USE-DISCOVERY-WORKER-MASTER-PROMPT.md`
- `AGENT_CONTRACT.md`

## 1. Mission

Build a user-owned discovery worker that:
- accepts JobBored discovery webhook requests
- resolves company names to supported ATS boards
- runs Browser Use-backed discovery across Greenhouse, Lever, and Ashby
- normalizes leads into valid JobBored Pipeline rows
- writes directly to Google Sheets
- supports both manual and scheduled runs
- supports both local and hosted deployment modes

## 2. Immutable repo facts

These are locked unless the orchestrator explicitly revises them.

- the dashboard remains a static app
- the discovery webhook request stays schemaVersion 1 in v1
- the dashboard sends `variationKey`
- dedupe is column E `Link`
- the dashboard only cares that valid Pipeline rows appear
- Apps Script stub is not real discovery readiness
- 202 Accepted is a valid async success path
- infrastructure remains user-owned
- tougher sites are second-layer adapters, not v1 core
- company list + keywords is the v1 discovery input model

## 3. Locked external request contract

Use the current request shape exactly.

```ts
type DiscoveryWebhookRequestV1 = {
  event: "command-center.discovery";
  schemaVersion: 1;
  sheetId: string;
  variationKey: string;
  requestedAt: string;
  discoveryProfile?: {
    targetRoles?: string;
    locations?: string;
    remotePolicy?: string;
    seniority?: string;
    keywordsInclude?: string;
    keywordsExclude?: string;
    maxLeadsPerRun?: string;
  };
};
```

Rule:
- no worker may widen or rename these fields
- if a worker thinks the contract must change, it must stop and leave an integration note for the orchestrator

## 4. Locked internal interfaces

These must be locked before workers start.

### 4.1 Normalized lead

```ts
type NormalizedLead = {
  sourceId: string;
  sourceLabel: string;
  title: string;
  company: string;
  location: string;
  url: string;
  compensationText: string;
  fitScore: number | null;
  priority: "🔥" | "⚡" | "—" | "↓" | "";
  tags: string[];
  fitAssessment: string;
  contact: string;
  status: string; // default "New"
  appliedDate: string;
  notes: string;
  followUpDate: string;
  talkingPoints: string;
  discoveredAt: string;
  metadata: {
    runId: string;
    variationKey: string;
    sourceQuery: string;
  };
};
```

### 4.2 Browser extraction result

```ts
type BrowserUseExtractionResult = {
  runId: string;
  sourceId: string;
  querySummary: string;
  leads: NormalizedLead[];
  warnings: string[];
  stats: {
    pagesVisited: number;
    leadsSeen: number;
    leadsAccepted: number;
  };
};
```

### 4.3 Pipeline write result

```ts
type PipelineWriteResult = {
  sheetId: string;
  appended: number;
  updated: number;
  skippedDuplicates: number;
  warnings: string[];
};
```

### 4.4 Webhook acknowledgement

```ts
type DiscoveryWebhookAck = {
  ok: true;
  kind: "accepted_async" | "completed_sync";
  runId: string;
  message: string;
};
```

### 4.5 Writer ownership rules

These are also locked:
- dedupe key is normalized `url` -> Pipeline column E `Link`
- inserts may populate A-Q
- existing user-managed workflow fields should not be clobbered
- worker should preserve status/notes/applied/follow-up/reply-tracking fields on existing rows unless the orchestrator explicitly decides otherwise

## 5. Recommended worker subtree

Target subtree:

`integrations/browser-use-discovery/`
- `src/contracts.ts`
- `src/config.ts`
- `src/browser/session.ts`
- `src/browser/source-adapters.ts`
- `src/browser/selectors/...`
- `src/normalize/lead-normalizer.ts`
- `src/sheets/pipeline-writer.ts`
- `src/run/run-discovery.ts`
- `src/webhook/handle-discovery-webhook.ts`
- `tests/...`
- `README.md`

## 6. Ownership map

### Orchestrator-owned files
Only the orchestrator may edit:
- `docs/BROWSER-USE-DISCOVERY-WORKER-ARCHITECTURE.md`
- `docs/BROWSER-USE-DISCOVERY-WORKER-MASTER-PROMPT.md`
- `docs/BROWSER-USE-DISCOVERY-WORKER-SWARM-REFERENCE.md`
- `integrations/browser-use-discovery/README.md`
- any top-level `README.md`
- `AGENT_CONTRACT.md`
- root schemas
- root CI/test wiring

### Worker 1 — Contracts + config + fixtures
Write scope:
- `integrations/browser-use-discovery/src/contracts.ts`
- `integrations/browser-use-discovery/src/config.ts`
- `integrations/browser-use-discovery/tests/fixtures/discovery-webhook-request.v1.json`
- `integrations/browser-use-discovery/tests/fixtures/normalized-lead.json`

Purpose:
- lock TypeScript types
- parse env/config safely
- create canonical fixtures

Must not edit:
- browser runtime
- sheets writer
- webhook handler
- top-level docs/contracts

### Worker 2 — Browser Use runtime + source adapters
Write scope:
- `integrations/browser-use-discovery/src/browser/session.ts`
- `integrations/browser-use-discovery/src/browser/source-adapters.ts`
- `integrations/browser-use-discovery/src/browser/selectors/*`
- `integrations/browser-use-discovery/tests/browser/*`

Purpose:
- Browser Use session lifecycle
- source adapter seam
- Greenhouse/Lever/Ashby extraction paths
- browser fallback behavior

Must not edit:
- Pipeline mapping
- sheets writer
- webhook contract
- top-level docs/contracts

### Worker 3 — Normalization + Sheets writer
Write scope:
- `integrations/browser-use-discovery/src/normalize/lead-normalizer.ts`
- `integrations/browser-use-discovery/src/sheets/pipeline-writer.ts`
- `integrations/browser-use-discovery/tests/sheets/*`

Purpose:
- final lead normalization
- Link-based dedupe preparation
- Pipeline row mapping
- append/update write logic

Must not edit:
- browser runtime
- webhook handler
- top-level docs/contracts

### Worker 4 — Run orchestrator + webhook entrypoint
Write scope:
- `integrations/browser-use-discovery/src/run/run-discovery.ts`
- `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts`
- `integrations/browser-use-discovery/tests/webhook/*`

Purpose:
- request validation
- `runId` and run lifecycle
- sync vs async acknowledgement
- composition of config -> browse -> normalize -> write

Must not edit:
- source adapter internals
- Pipeline mapping internals
- top-level docs/contracts

### Worker 5 — QA harness + local developer path
Write scope:
- `integrations/browser-use-discovery/tests/e2e/*`
- `integrations/browser-use-discovery/tests/mocks/*`
- `integrations/browser-use-discovery/.env.example`
- `integrations/browser-use-discovery/docs/QA.md`

Purpose:
- repeatable local QA path
- mock pages/fixtures
- operator checklist
- local developer setup validation

Must not edit:
- runtime code outside its scope
- top-level docs/contracts

## 7. Safe execution phases

### Phase 0 — orchestrator only
- create subtree and seam files
- lock interfaces in the architecture doc and this reference
- create any minimal bootstrapping files needed for workers

### Phase 1 — parallel
Spawn together:
- Worker 1
- Worker 2
- Worker 3

Why this is safe:
- contracts are frozen first
- browser, normalization, and writing have disjoint write scopes

### Phase 2 — parallel
Spawn together after Phase 1 interfaces stabilize:
- Worker 4
- Worker 5

Why this is safe:
- webhook/run composition depends on the browser + writer seams
- QA/local path depends on stable contracts and runtime entrypoints

### Phase 3 — orchestrator only
- merge worker outputs
- resolve interface mismatches centrally
- wire README/root docs/tests as needed
- run final checks

## 8. Shared worker rules

Every worker must follow these rules:
- you are not alone in the repo
- do not revert changes you did not make
- read any file you need, but edit only your write scope
- if you need a locked interface changed, stop and leave an integration note
- do not edit top-level contract docs
- do not silently widen behavior beyond the locked interfaces
- keep tougher-site logic out of the v1 core path
- report exact files changed and exact exported APIs

## 9. Worker handoff format

Every worker must end with this exact structure:

```text
Files changed:
- ...

Exports / entrypoints added:
- ...

Assumptions made:
- ...

Integration notes for orchestrator:
- ...

Blocked-by / contract conflicts:
- ...

Suggested tests:
- ...
```

## 10. Master merge checklist

The orchestrator must verify all of these:
- no worker edited outside its scope
- no worker changed locked interfaces without approval
- webhook request still matches `AGENT_CONTRACT.md`
- `variationKey` flows into run metadata
- company list + keywords remains the effective input model
- dedupe still keys on Link
- ack behavior clearly supports `200` or `202`
- v1 sources remain Greenhouse/Lever/Ashby only
- tougher sites remain second-layer adapters only
- docs and implementation remain aligned
- local QA path exists and is user-owned

## 11. Acceptance gates

The whole swarm effort is not done until all are true:
- accepts JobBored discovery webhook request v1
- resolves/discovers jobs across Greenhouse, Lever, and Ashby
- normalizes results into the locked lead shape
- writes valid Pipeline rows directly to Google Sheets
- preserves Link-based dedupe
- supports both local and hosted modes
- supports both manual and scheduled runs
- keeps tougher sites out of the v1 core path
- includes a local QA harness and operator path

## 12. Explicit non-goals

These are off-limits unless the orchestrator explicitly re-scopes the project:
- maintainer-hosted central discovery service
- redesigning the dashboard webhook contract for v1
- blending tougher-site adapters into the first-layer core flow
- moving dedupe away from Link
- making workers edit top-level repo docs/contracts directly
