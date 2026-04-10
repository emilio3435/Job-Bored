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
  - For starter-sheet end-to-end validation on this machine, plan to complete a live Google sign-in in the validator browser session before expecting the real create-sheet flow to complete.
  - On the latest baseline-readiness rerun, the standard `agent-browser` path on `http://localhost:8080` already had a reusable Google session available, so starter-sheet validation succeeded without an interactive cookie-import step. Try the normal browser flow before assuming extra auth bootstrap is required.
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

## Flow Validator Guidance: dashboard-browser-https

- Use this surface for browser assertions that only need the dashboard plus scraper/ATS routing, including mixed-content checks on an HTTPS-served dashboard.
- Prefer a browser session that starts with empty app localStorage/IndexedDB unless the assertion explicitly needs persisted app config.
- If port `8080` is already occupied by another active mission worktree, start an isolated HTTPS dashboard on a temporary port from this repo checkout and use that temporary origin for the validator session; do not stop the external listener.
- If port `3847` is already occupied by another active mission worktree, start an isolated scraper/ATS server on a temporary port from this repo checkout and point the app's saved scraper/ATS base URL at that temporary port for the session.
- Stay within browser-visible product flows: use Settings or in-app actions to change scraper/ATS endpoints instead of editing source files or bypassing the UI.
- Capture the final browser origin and ATS base URL used in the flow report so reruns can reproduce the same surface.

## Flow Validator Guidance: dashboard-browser-authenticated

- Use this surface for starter-sheet and other Google-authenticated browser flows that require a real Google session.
- Keep this validator isolated from other browser validators with a dedicated browser session and fresh app storage before any auth bootstrap steps.
- If the browser tooling supports cookie import, bootstrap the session from the machine's existing Chromium Google cookies before attempting the flow. Import only the minimum Google domains needed for sign-in and Sheets/starter-sheet creation.
- If cookie import is unavailable or insufficient, attempt the real Google sign-in flow in the validator browser session and record the exact screen/state reached.
- Do not mock Google APIs or short-circuit starter-sheet creation. If the flow blocks on missing/expired real credentials or an unfinishable auth challenge, mark the assertion blocked with the exact blocker.
- Capture the browser origin, whether cookie import or live sign-in was used, and any Google create/write network calls observed.

## Flow Validator Guidance: discovery-browser

- Use this surface for discovery-setup, endpoint-validation, local-recovery, and cross-area discovery browser assertions on `http://localhost:8080`.
- Use a dedicated agent-browser session (`--session`) per subagent. Do not share sessions between subagents.
- Start from a known app state: use `?sheet=1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ` to provide a sheet ID. Note: the `?sheet=` parameter alone does NOT bypass the Google auth gate for the dashboard — it only provides the sheet ID. The dashboard still requires Google sign-in when an OAuth client ID is configured. The Settings modal IS accessible from the auth gate screen via the gear icon, which allows testing discovery setup/validation flows without full dashboard access.
- **Round 1 finding:** The Google auth gate blocks dashboard/board/brief/pipeline access even with a publicly readable sheet. Validators that need dashboard-level UI (Run discovery button, run-modal preferences, board-level CTAs) require an authenticated browser session via cookie import or live sign-in. Settings-modal-level discovery flows (wizard, endpoint validation, preferences) work without auth.
- Discovery worker is at `http://127.0.0.1:8644` (health OK). Note: the worker requires `x-discovery-secret` auth on POST routes but the browser code does not send this header. Browser POSTs to the local worker will get 401. This is expected — assertions about client-side validation, setup routing, and recovery states can still be tested. For assertions requiring actual POST success (e.g., VAL-DISCOVERY-002 payload verification), capture the outbound request even if the response is 401.
- Do not modify the worker config, app source, or config.js to work around auth. Test what exists and report auth gaps as blockers.
- Discovery assertions share browser localStorage state (saved discovery endpoint, wizard progress, preferences). Use separate browser sessions for concurrent validators. If two validators must mutate the same localStorage keys, serialize them or accept potential interference.
- The `discovery-local-bootstrap.json` file in the repo root provides local bootstrap data for localhost autofill assertions.
- For wizard-state resume assertions, partially progress through the wizard, close it, then reopen from a different entry point.
- For tunnel-rotation and blocked-state recovery assertions, manipulate discovery config in localStorage to simulate the blocked state rather than relying on real tunnel rotation.
- Do not attempt real Google sign-in in this surface unless the assertion explicitly requires it. Most discovery setup assertions work in read-only/auth-free mode.
- Evidence files go to `evidence/discovery-consolidation/<group-id>/`. Flow reports go to `.factory/validation/discovery-consolidation/user-testing/flows/<group-id>.json`.
