# User Testing

Testing surfaces, tools, setup notes, and concurrency guidance for this mission.

**What belongs here:** user-facing validation surfaces, required tools, environment assumptions, isolation notes, and concurrency limits.  
**What does NOT belong here:** service start/stop commands (use `.factory/services.yaml`).

---

## Validation Surface

### 1. Dashboard browser surface
- **URL:** `http://localhost:8080` by default, or `https://localhost:8080` for mixed-content ATS validation via the manifest `web_tls` service
- **Tool:** `agent-browser`
- **Primary behaviors:** sheet access/setup, Daily Brief, board lanes, drawer flows, settings, onboarding/profile, drafts, discovery entry points
- **Setup notes:**
  - Prefer a clean browser profile for first-run/setup assertions.
  - For starter-sheet end-to-end validation, import Google-authenticated browser cookies into the validator session before expecting the real create-sheet flow to complete.
  - Use a signed-in browser state for writeback assertions.
  - Some assertions require seeded sheet data and/or seeded local IndexedDB state.
  - The local HTTPS surface uses a generated self-signed localhost certificate; use `agent-browser --ignore-https-errors` (or the browser warning bypass) when validating it.

### 2. Local scraper and ATS surface
- **URL:** `http://127.0.0.1:3847`
- **Tools:** `curl` for endpoint contract checks, `agent-browser` for browser-triggered ATS/scrape flows
- **Primary behaviors:** `/health`, `/api/scrape-job`, `/api/ats-scorecard`, ATS loading/error/success UI
- **Setup notes:**
  - Live ATS requests use the configured provider and may incur cost.
  - `VAL-ATS-002` requires the HTTPS dashboard surface on `https://localhost:8080`; start manifest services `web_tls` and `scraper` (or run `npm run web-only:https` plus `npm run start:scraper`) before opening the browser session.
  - For non-localhost browser runs, mixed-content restrictions are part of the expected behavior.

### 3. Discovery browser surface
- **URL:** `http://localhost:8080`
- **Tool:** `agent-browser`
- **Primary behaviors:** discovery setup wizard, endpoint validation, stub-vs-real classification, run-discovery modal/preferences, local recovery flows
- **Setup notes:**
  - Some local discovery assertions depend on `discovery-local-bootstrap.json`, local `/health`, and ngrok tunnel state.
  - Browser-side success for async runs is not enough by itself; pair with worker/log or sheet evidence when the contract requires eventual completion.

### 4. Discovery worker surface
- **URL:** `http://127.0.0.1:8644`
- **Tools:** `curl` for `/health`, CORS, POST/preflight checks; `agent-browser` for browser-triggered end-to-end discovery flows
- **Primary behaviors:** health, POST acceptance, preflight failures, dedupe/update semantics, sheet writes, eventual async outcomes
- **Setup notes:**
  - Use the disposable validation sheet for seeded dedupe/update assertions.
  - For assertions about append/update preservation, use deterministic seeded rows and explicit readback evidence.

## Validation Concurrency

Machine baseline observed during dry run:
- **CPU:** 18 logical cores
- **Memory:** ~48 GiB total
- **Usable headroom assumption:** conservative because the browser, discovery worker, and ATS calls can all spike unpredictably

### Dashboard/browser surface
- **Max concurrent validators:** 2
- **Why:** browser-driven validation multiplies browser memory and local auth/profile state. Keep low to avoid flaky UI state contamination and credential contention.

### Local scraper / ATS surface
- **Max concurrent validators:** 1
- **Why:** ATS validation uses live provider calls and the local service is part of current readiness repair. Parallelism adds cost and noise without increasing confidence.

### Discovery worker surface
- **Max concurrent validators:** 1
- **Why:** discovery runs can write the same sheet, fan out to multiple sources, and depend on async completion semantics. Parallel runs risk duplicate writes and hard-to-debug races.

## Isolation Notes

- Separate first-run/setup assertions from returning-user assertions whenever possible.
- Use explicit seeded rows for dedupe/update and workflow-field preservation checks.
- When validating async discovery outcomes, require bounded evidence of completion (`updated/appended rows`, explicit warning, or explicit failure), not only `202 Accepted`.
- Keep browser-side config/localStorage assertions separate from IndexedDB-backed profile/draft assertions when triaging failures.
