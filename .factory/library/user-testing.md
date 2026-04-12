# User Testing

Testing surfaces, tools, setup notes, and concurrency guidance for this mission.

**What belongs here:** user-facing validation surfaces, tool requirements, setup constraints, and concurrency limits.  
**What does NOT belong here:** service commands and ports (use `.factory/services.yaml`).

---

## Validation Surface

### 1) Browser discovery UX surface
- **URL:** `http://localhost:8080` (use this origin for OAuth flows; avoid `127.0.0.1` for sign-in)
- **Tool:** `agent-browser`
- **Covers:** preset controls (`Browser only`, `ATS only`, `Browser+ATS`), persistence, run initiation feedback, async/terminal status transitions, non-silent failures.
- **Setup notes:**
  - Use a fresh browser session per validator.
  - Capture run-linked evidence (`runId`, `statusPath`) from network + UI.
  - If auth-gated surfaces are required, use real Google sign-in/cookie import on `localhost`; do not mock.
  - Preset controls are reachable while logged out via Settings → Discovery and discovery setup modal path.
  - **OAuth note:** The OAuth client is configured for `localhost:8080` but NOT for `127.0.0.1:8080`. Always use `http://localhost:8080` for OAuth flows.
  - **Preset controls access:** The preset controls (radio buttons `input[name='dpSourcePreset']`) are inside a hidden modal (`discoveryPrefsModal`). If normal UI flow is unavailable (e.g., due to auth), they can be accessed via JavaScript: `document.getElementById('discoveryPrefsModal').style.display='flex'` or call `openDiscoveryPrefsModal()` from the console.
  - **Input guard check:** verify Run is blocked when both target roles and include keywords are blank, and UI suggests using the AI Suggester tab (no webhook request should fire).
  - **AI Suggest bridge check:** when AI Suggest fields are populated but manual intent fields are blank, Run should proceed without blank-intent warning and webhook payload should include resolved canonical intent fields.
  - **Unrestricted company scope check:** with empty company config, runs should still launch and not be implicitly constrained to previous fixed-company defaults.
  - **Modifier-driven grounded check:** unrestricted grounded query evidence should reflect role/keyword/location modifiers and avoid placeholder/company-label artifacts.

### 2) Discovery worker API surface
- **URL:** `http://127.0.0.1:8644`
- **Tool:** `curl`
- **Covers:** webhook auth/schema validation, preset payload handling, routing enforcement, run lifecycle, readiness reporting.
- **Setup notes:**
  - Include `x-discovery-secret` for authenticated requests.
  - Read the shared secret from `discovery-local-bootstrap.json` (`webhookSecret`) for curl requests.
  - For async runs, always poll `/runs/{runId}` to terminal.
  - Validate local vs hosted `sheetId` mode boundaries where applicable.
  - Validate missing run-intent requests fail explicitly (no silent fallback): missing/blank preset and blank both targetRoles+keywordsInclude should be rejected with clear errors.

### 3) Google Sheets write-proof surface
- **Tool:** `curl` + Google Sheets API readback (or equivalent deterministic sheet read evidence)
- **Covers:** writeResult integrity, canonical `Link`, source attribution, write failure transparency, append/update reconciliation.
- **Setup notes:**
  - Use service-account-backed credentials.
  - Scope evidence to rows changed by the current run to avoid historical false positives.

## Validation Concurrency

Dry-run baseline (2026-04-11): 18 logical CPUs, 48 GiB RAM, heavy discovery execution path materially increases CPU and memory.

### Concurrency limits (70% headroom policy)

- **Browser UI reachability checks:** max **5**
  - lightweight page-load/state assertions only
- **Webhook run-trigger + full discovery execution:** max **1**
  - includes source execution and sheet writes; serialize to avoid race conditions and noisy evidence
- **Run-status polling checks:** max **5**
  - lightweight read-only endpoint validation
- **Sheet write-proof assertions:** max **1**
  - serialized to prevent overlap in mutation evidence windows

## Isolation Guidance

- Use dedicated browser sessions per flow validator.
- Do not run concurrent validators that mutate the same discovery preset storage keys.
- Treat each run as runId-scoped evidence bundle: ack, poll timeline, terminal status, and sheet delta.
- For routing truth-table assertions, use positive-control inputs (where both ATS and browser lanes are discoverable) to avoid vacuous passes.

## Required evidence bundle for each terminal run assertion

1. Run initiation evidence: webhook ack (`runId`, `statusPath`, `pollAfterMs`)
2. Lifecycle evidence: status polling sequence until `terminal=true`
3. Source evidence: per-source counters/warnings and lane inclusion/exclusion proof
4. Data evidence: writeResult + sheet readback for the same run window
5. UI evidence (for browser assertions): screenshots showing preset selection and terminal state for the same runId

## Quality-Hardening Follow-up Checks

- Grounded HTML fallback extraction does not promote junk navigation text as job titles (e.g., “skip to content”).
- Run-level dedupe uses multi-signal identity (not URL-only), reducing repeated low-quality opportunities across alternate URLs.
- AI-suggest-filled discovery intent is accepted by UI run guard and bridged into canonical webhook intent fields.
- Empty company config should not trigger preflight rejection; unrestricted runs must execute with truthful per-lane attribution under all presets.
- Valid unrestricted grounded runs should not surface misleading missing-company warnings when intent modifiers are present.
- Multi-query fan-out should be visible in run diagnostics for unrestricted grounded runs, with focused role/location/keyword sub-queries and cap adherence.
- Retry broadening should show ordered rung evidence on zero-candidate sub-queries and remain absent when first rung succeeds.
- Fetch-fallback extraction should emit explicit structured diagnostics, including low-content/skeleton-page attribution when applicable.
- Non-JSON grounded responses should recover supported URLs via regex fallback and emit explicit fallback warning/diagnostic entries.
- Budget behavior should surface structured reduced-page-limit and budget-skip diagnostics before run timeout.
- Parallel company execution should respect configured concurrency caps and preserve per-company failure isolation in terminal status.
- Structured diagnostics should include stable code + context for zero-result outcomes while warning-string compatibility remains present.
- Browser-only preset tuning uplift should apply when tunables are omitted, and explicit run payload overrides should remain unchanged.

---

## Known Issues and Fixes (Troubleshooting)

### Grounded-web stage stalls during browser-only validation runs
- **Problem:** browser_only discovery runs do not terminalize within reasonable test windows (observed: 45+ seconds elapsed, grounded_web stage still running, not completing)
- **Symptom:** VAL-OBS-005/006/007/008 require terminal degraded runs but grounded_web lane stalls indefinitely
- **Workaround:** Use `ats_only` preset for faster terminalization (2-3 minutes). VAL-API-004 confirmed terminalization works correctly when data is available. browser_only path should be tested with production data or longer test windows.
- **Related:** The 5-minute `maxRunDurationMs` safety timer (commit 7dd4c45) will force terminalization but that's too long for interactive validation.

### Browser-only discovery runs may not terminalize within reasonable test windows
- The grounded_web stage with Gemini can take 5+ minutes or not complete when no jobs are found
- For interactive validation, prefer `ats_only` preset which terminalizes in 2-3 minutes
- VAL-API-004 (async ack trackability) was confirmed working with `ats_only` preset

### renderDiscoveryRunStatus() not auto-called on page load
- The discovery run status rendering is not automatically called on page load
- After reload/reopen, call `renderDiscoveryRunStatus()` manually from browser console to recover UI state
- Related to VAL-UI-STATUS-007 validation

## Credential Baseline for Routing/User-Testing (2026-04-12)

- Discovery worker is started with:
  - service-account file: `/Users/emilionunezgarcia/Downloads/elio-ai-prod-4bae66f7bba7.json`
  - sourced env files: `integrations/browser-use-discovery/.env` and `server/.env`
  - Gemini fallback: `ATS_GEMINI_API_KEY` from `server/.env` when discovery-specific key is unset
- For authenticated API assertions, use `discovery-local-bootstrap.json` `webhookSecret`.
- If `/health` shows `sheetsCredentialConfigured: false` or `groundedWeb.ready: false`, treat as setup regression and re-check env sourcing before marking assertions blocked.

## Known Issues and Fixes (Troubleshooting)

### Shell source pattern for worker startup
- **Problem:** Using `source <(...)` subshell pattern fails to export SECRET from .env (empty value when read inside the script)
- **Symptom:** Worker returns 401 Unauthorized on webhook requests
- **Fix:** Use direct sourcing pattern in the same shell process:
  ```
  set -a
  [ -f "$PWD/integrations/browser-use-discovery/.env" ] && . "$PWD/integrations/browser-use-discovery/.env"
  [ -f "$PWD/server/.env" ] && . "$PWD/server/.env"
  set +a
  ```
  Then run `echo $BROWSER_USE_DISCOVERY_WEBHOOK_SECRET` to verify it has a value before starting the worker.

### Correct webhook payload format
- **Event name:** `command-center.discovery` (not `discovery.run_requested` from older docs)
- **Required fields:** `event`, `schemaVersion` (1), `variationKey`, `requestedAt` (ISO timestamp), `sheetId`, `discoveryProfile.sourcePreset`
- **Example:** `{"event": "command-center.discovery", "schemaVersion": 1, "sheetId": "...", "variationKey": "...", "requestedAt": "2026-04-11T12:00:00Z", "discoveryProfile": {"sourcePreset": "ats_only"}}`

### Async terminalization is now working
- The 5-minute `maxRunDurationMs` safety timer (commit 7dd4c45) forces terminalization for async runs
- Runs should reach terminal state within ~4-5 minutes even if source execution stalls
- Check `terminal=true` in `/runs/{runId}` response

### Sheets permission is the current blocker
- `/health` shows `sheetsCredentialConfigured: true` — service account JSON is valid
- But Sheets write fails with `HTTP 403 PERMISSION_DENIED`
- The service account needs **Editor** role on the specific target sheet (not just project-level IAM)
- To fix: Share the Google Sheet with the service account email from the JSON key file
