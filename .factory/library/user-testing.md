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

### 2) Discovery worker API surface
- **URL:** `http://127.0.0.1:8644`
- **Tool:** `curl`
- **Covers:** webhook auth/schema validation, preset payload handling, routing enforcement, run lifecycle, readiness reporting.
- **Setup notes:**
  - Include `x-discovery-secret` for authenticated requests.
  - Read the shared secret from `discovery-local-bootstrap.json` (`webhookSecret`) for curl requests.
  - For async runs, always poll `/runs/{runId}` to terminal.
  - Validate local vs hosted `sheetId` mode boundaries where applicable.

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

---

## Credential Baseline for Routing/User-Testing (2026-04-12)

- Discovery worker is started with:
  - service-account file: `/Users/emilionunezgarcia/Downloads/elio-ai-prod-4bae66f7bba7.json`
  - sourced env files: `integrations/browser-use-discovery/.env` and `server/.env`
  - Gemini fallback: `ATS_GEMINI_API_KEY` from `server/.env` when discovery-specific key is unset
- For authenticated API assertions, use `discovery-local-bootstrap.json` `webhookSecret`.
- If `/health` shows `sheetsCredentialConfigured: false` or `groundedWeb.ready: false`, treat as setup regression and re-check env sourcing before marking assertions blocked.
