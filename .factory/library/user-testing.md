# User Testing

Validation surface, setup, and concurrency rules for the opportunity-loop mission.

## Validation Surface

### 1) Local discovery worker API
- URL: `http://127.0.0.1:8644`
- Tool: `curl`
- Coverage:
  - webhook auth/schema/preflight behavior,
  - async ack/run status lineage,
  - scout/score/exploit telemetry visibility.

### 2) Public relay webhook API
- URL: user-provided public relay (`...workers.dev`)
- Tool: `curl`
- Coverage:
  - public `POST /webhook` contract compatibility,
  - async lifecycle parity with local worker.
- Note: public `/health` is optional; public smoke is webhook POST + status polling.

### 3) Real integration data plane
- Tool: `curl` + deterministic run-status/readback checks
- Coverage:
  - Gemini-backed grounded behavior,
  - Sheets-backed write outcomes and writeResult transparency.

## Required Setup

- `integrations/browser-use-discovery/.env` must include:
  - `BROWSER_USE_DISCOVERY_WEBHOOK_SECRET`
  - `BROWSER_USE_DISCOVERY_GEMINI_API_KEY`
  - `BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE`
- Service-account email must be **Editor** on the target Sheet.
- Local worker must be running on `127.0.0.1:8644`.

## Validation Concurrency

Dry run confirmed this mission is CPU-heavy for realistic runs. Use conservative concurrency:

- Local webhook+run execution validators: **1**
- Public relay smoke validators: **1**
- Combined local/public mutation flows: **1**

## Execution Policy

- Real integrations are required (no mocks by default).
- Each milestone validation includes:
  1) local webhook/run validation and
  2) public webhook POST smoke.
- Strict browser-only enforcement is a **final milestone gate**:
  - any non-browser extraction mode must be diagnosable and treated as validation failure for that gate.

## Flow Validator Guidance: node-test

- Tool: `node --experimental-strip-types --test`
- All node-test assertions are stateless/unit tests — no shared mutable state between test files.
- Concurrency: **1** (no benefit from parallelizing node-test runs; sequential is safest).
- Isolation: no special isolation needed — test runner handles its own sandboxing.
- Assertions can be tested by running the relevant test files and mapping named tests to assertion IDs.
- Key test directories: `integrations/browser-use-discovery/tests/webhook/`, `tests/browser/`, `tests/sheets/`, `tests/discovery/`, `tests/state/`.
- No browser or curl needed for node-test surface.

## Flow Validator Guidance: curl

- Tool: `curl` (plus shell JSON parsing for ack/status polling)
- Concurrency: **1** for this milestone to avoid shared-state races in run lifecycle polling and external integration throttling.
- Isolation boundary:
  - Use only `http://127.0.0.1:8644` for local flow checks and the mission-provided public relay URL for public smoke checks.
  - Do not mutate `.env` or service credentials.
  - Keep secrets out of evidence files (redact webhook secret and bearer material).
- Required flow for `VAL-LOOP-CROSS-005`:
  - Webhook payload must include `variationKey` (missing field is rejected before run allocation).
  - `discoveryProfile` intent fields must use contract-correct string values (array-shaped intent fields are rejected as blank/invalid).
  1. Start local discovery worker and confirm `/health`.
  2. POST `/webhook` locally, capture `runId` + `statusPath`, poll until terminal.
  3. POST `/webhook` to the public relay, capture lineage, poll until terminal.
  4. Record whether both local and public paths reached terminal lifecycle for real integrations.

## Evidence Bundle Per End-to-End Assertion

1. Webhook request + response (status + body, secret redacted)
2. `runId` + `statusPath` lineage
3. Polling transcript to terminal state
4. Source summary/diagnostics proving lane behavior
5. WriteResult + canonical-link evidence for affected rows
