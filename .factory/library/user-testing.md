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

## Evidence Bundle Per End-to-End Assertion

1. Webhook request + response (status + body, secret redacted)
2. `runId` + `statusPath` lineage
3. Polling transcript to terminal state
4. Source summary/diagnostics proving lane behavior
5. WriteResult + canonical-link evidence for affected rows
