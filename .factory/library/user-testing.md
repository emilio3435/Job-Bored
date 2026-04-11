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

**Round 2 lesson (frontend-decomposition):** Setup features claimed "signed-in browser state is ready" but agent-browser creates fresh browser profiles that don't inherit Google auth cookies from the user's real Chrome browser. For write-access assertions (VAL-DASH-009, 010, 011, 018), you MUST either:
1. Use `setup-browser-cookies` skill to import Google cookies into the agent-browser session BEFORE testing, OR
2. Have the user perform a live Google sign-in in the agent-browser session (requires user interaction)

Without one of these steps, the browser will show "Continue" button for Google sign-in and CRM fields will be hidden in browse-only mode.

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

## Flow Validator Guidance: dashboard-browser-board-brief

- Use this surface for Daily Brief, board lanes, search, sort, empty states, lane chrome, and related read-mostly dashboard assertions.
- Start with a fresh browser session (`--session` unique per validator). Use `?sheet=1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ` to provide the sheet ID.
- These assertions do NOT require Google sign-in for read-only board access when using a publicly readable sheet. The dashboard loads in browse-only mode.
- Search and sort mutate localStorage (search query, sort preference) but these are local UI state only — concurrent validators with separate sessions will not interfere.
- For VAL-DASH-001 (Daily Brief), verify: local-date header, non-empty headline, four visible summary tiles, stage distribution widget, activity chart, activity feed, sources/tips panel.
- For VAL-DASH-003 (Search), type a search term matching pipeline/CRM text, verify the `x of y` count updates while the Brief remains computed from full pipeline.
- For VAL-DASH-004 (Sort), change sort control and verify lane reordering without changing lane grouping.
- For VAL-DASH-005 (Lane order), verify non-empty lanes appear in canonical order: New, Researching, Applied, Phone Screen, Interviewing, Offer, Rejected, Passed.
- For VAL-DASH-012 (No-match search), search for a term with no matches and verify "No roles match" empty state while Brief remains intact.
- For VAL-DASH-013 (Empty pipeline), this requires an empty sheet; may need to temporarily use a different sheet or skip if not testable.
- For VAL-DASH-014 (Activity range), switch activity range controls and verify chart timeframe updates.
- For VAL-DASH-015 (Lane expansion), verify active lanes start expanded, archive lanes (Rejected, Passed) start collapsed, and toggling works.
- For VAL-DASH-016 (Lane scroll), verify horizontal scroll controls on long lanes disable at track edges.
- Evidence files go to `evidence/frontend-decomposition/<group-id>/`. Flow reports go to `.factory/validation/frontend-decomposition/user-testing/flows/<group-id>.json`.

## Flow Validator Guidance: dashboard-browser-drawer-crm

- Use this surface for drawer open/close, detail rendering, signed-out browse mode, signed-in CRM edits, status changes, and enrichment flows.
- Start with a fresh browser session (`--session` unique per validator). Use `?sheet=1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ` to provide the sheet ID.

### Activity Feed Preflight (VAL-DASH-002)

Before running VAL-DASH-002, run the activity feed preflight script to verify/setup overdue followUpDate data:

```bash
node scripts/check-activity-feed-prerequisites.mjs --verify  # Check only
node scripts/check-activity-feed-prerequisites.mjs --seed    # Check and attempt to seed
```

The script will:
- Verify if the sheet has overdue followUpDate rows
- Attempt to materialize an overdue row via Google Sheets API (if credentials available)
- Print explicit manual fallback instructions if API write fails

If the script exits with code 1 (no overdue rows), manually update the sheet:
1. Open: `https://docs.google.com/spreadsheets/d/1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ/edit`
2. Find a row with a future Follow-up Date (column P)
3. Change it to a past date (e.g., 2026-04-05 for today being 2026-04-10)

### Auth Setup for CRM Assertions

**CRITICAL for auth-required assertions (VAL-DASH-002, VAL-DASH-009, VAL-DASH-010, VAL-DASH-011, VAL-DASH-018):**

`agent-browser` creates fresh browser profiles that do NOT inherit Google auth cookies from your real Chrome browser.

**Round 5 update:** the refreshed runtime token bridge at `/Users/emilionunezgarcia/agent-browser-access-token.txt` is sufficient for validator-session auth bootstrap by itself; the earlier marker-state dependency was no longer present. Preferred order:

1. **Runtime token bridge (preferred on this machine):**
   - Inject the local access token into the page runtime without printing it.
   - Ensure the runtime session includes Sheets scopes and a valid expiry, then call app helpers such as `updateAuthUI()` / `persistOAuthSession()` if available.
   - Before testing write assertions, prove the same session is really authorized: `Continue` absent, CRM controls visible, Google userinfo `200`, and a Sheets probe `200`.

2. **Live sign-in (fallback if the token bridge stops working):**
   - Navigate to `http://localhost:8080`
   - Click "Sign in with Google" in the dashboard
   - Complete the OAuth flow with your Google account
   - Verify the "Continue" button is no longer visible

3. **Cookie import (last resort if live sign-in is unavailable):**
   ```bash
   ~/.claude/skills/gstack/browse/dist/browse cookie-import-browser
   ```
   Select Chrome browser and import cookies for `google.com` and `googlesyndication.com`.

### Assertion-Specific Notes

- For signed-out assertions (VAL-DASH-008), verify drawer opens in browse-only mode with writeback controls hidden or replaced with sign-in guidance.
- For VAL-DASH-002, click a Brief activity feed item (overdue follow-up) and verify it opens the matching job drawer with correct title/company.
- For VAL-DASH-006, click a stage card and verify drawer opens; close via button or Escape.
- For VAL-DASH-007, test a job with no posting enrichment and verify core identity (title, company, location/salary, action row) still shows.
- For VAL-DASH-009, with signed-in session, verify drawer exposes editable CRM controls and can save changes.
- For VAL-DASH-010, change status via drawer and verify job moves to correct lane after refresh.
- For VAL-DASH-011, edit follow-up date to overdue and verify visible overdue signal on dashboard.
- For VAL-DASH-017, open a job that can fetch enrichment and verify loading state then enriched/warning state.
- For VAL-DASH-018, with drawer open, save a CRM change and verify drawer stays attached to same role with no stale state.
- CRM edits write to the Google Sheet. Use the disposable sheet for validation. Capture network evidence of POST batchUpdate calls.
- For VAL-DASH-013 on the real empty fixture `1zK-I18WITjwcqsx4LgVSFk-dmAot2dxHae1Y0N9CPB0`, a fresh session may still need auth bootstrap plus onboarding completion before the empty-state dashboard becomes the topmost visible surface. Do not use DOM/style hacks; use the real auth/onboarding path.
- Evidence files go to `evidence/frontend-decomposition/<group-id>/`. Flow reports go to `.factory/validation/frontend-decomposition/user-testing/flows/<group-id>.json`.

## Flow Validator Guidance: onboarding-profile-browser

- Use this surface for onboarding flow, profile persistence, and missing-profile recovery assertions.
- Start with a clean browser profile (no saved localStorage/IndexedDB) for first-run assertions.
- For VAL-DRAFTS-001, verify incomplete onboarding gates draft features even after sheet access is resolved.
- For VAL-DRAFTS-002, test resume upload step — verify continue disabled until valid input, and unsupported input shows failure.
- For VAL-DRAFTS-003, complete onboarding and verify resume + preferences persist after reload.
- For VAL-DRAFTS-004, save a new primary resume and verify it replaces (not duplicates) the previous one.
- For VAL-DRAFTS-005, attempt draft action with no profile and verify recoverable guidance (not silent failure).
- For VAL-DRAFTS-011, use Settings "Clear saved settings" and verify portfolio/draft history remains intact.
- For VAL-DRAFTS-012, provide writing samples or AI context during onboarding and verify persistence after reload.
- For VAL-DRAFTS-014, verify that having at least ONE profile source (resume OR LinkedIn OR AI context) enables generation.
- For VAL-DRAFTS-016, save/clear LinkedIn and AI context fields and verify isolated removal (not cascade to resume/samples).
- For VAL-DRAFTS-017, start "Redo onboarding wizard" and verify existing data preserved until new flow completes.
- For VAL-CROSS-008, attempt draft without profile, verify recovery path into Profile, then verify generation works after adding profile.
- Profile data is stored in IndexedDB. Do not mock this — use real browser persistence.
- Evidence files go to `evidence/frontend-decomposition/<group-id>/`. Flow reports go to `.factory/validation/frontend-decomposition/user-testing/flows/<group-id>.json`.

## Flow Validator Guidance: draft-generation-browser

- Use this surface for draft generation, refinement, version history, ATS analysis in draft context, and provider routing assertions.
- Requires signed-in session + completed profile (resume or LinkedIn or AI context).
- For VAL-DRAFTS-006, generate cover letter or tailored resume, verify draft modal opens with V1 saved.
- For VAL-DRAFTS-007, submit refinement feedback and verify new version created (not overwrite).
- For VAL-DRAFTS-008, open saved draft from history and verify exact text restored from snapshot.
- For VAL-DRAFTS-009, verify ATS analysis starts inside draft modal when text + job metadata present, refreshes after draft changes.
- For VAL-DRAFTS-010, test unsupported/missing provider configuration and verify actionable guidance.
- For VAL-DRAFTS-013, generate + refine drafts, reload page, and verify version history intact.
- For VAL-DRAFTS-015, verify generation uses configured provider (Gemini/webhook) destination.
- For VAL-CROSS-007, fetch posting enrichment for a role, then trigger ATS and verify enrichment included in payload.
- For VAL-CROSS-009, generate draft, then verify same saved version visible from both job surface and draft modal/history.
- For VAL-CROSS-010, verify ATS requests use active draft text + current job context; demonstrate by editing draft or switching roles and checking payload changes.
- Drafts stored in IndexedDB. Generation may call live AI provider (Gemini) or webhook.
- Evidence files go to `evidence/frontend-decomposition/<group-id>/`. Flow reports go to `.factory/validation/frontend-decomposition/user-testing/flows/<group-id>.json`.
