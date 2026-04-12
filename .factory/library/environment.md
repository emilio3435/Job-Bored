# Environment

Environment variables, external dependencies, and setup notes for this mission.

**What belongs here:** required env vars, credential paths, external dependencies, runtime assumptions.  
**What does NOT belong here:** service start/stop commands and ports (use `.factory/services.yaml`).

---

## Required external dependencies

- Google Sheets API (target `Pipeline` sheet)
- Discovery worker (`integrations/browser-use-discovery`)
- Browser runtime command (`browser-use`) for full browser-enabled sourcing
- Gemini API for grounded web search lane (when enabled)

## Required runtime configuration

### Discovery worker auth + routing
- `BROWSER_USE_DISCOVERY_WEBHOOK_SECRET`
- Browser config/Settings value: `discoveryWebhookSecret` must match worker secret

### Google Sheets write credentials (service account path selected)
- `BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE` (absolute local path)
- Service account JSON must contain valid `client_email` and `private_key`
- Target sheet must be shared with the service account email
- Current local validation path: `/Users/emilionunezgarcia/Downloads/elio-ai-prod-4bae66f7bba7.json`

### Browser-enabled search runtime
- `BROWSER_USE_DISCOVERY_BROWSER_COMMAND` (or `browser-use` on PATH)
- `BROWSER_USE_DISCOVERY_GEMINI_API_KEY`
- Optional tuning:
  - `BROWSER_USE_DISCOVERY_GEMINI_MODEL`
  - `BROWSER_USE_DISCOVERY_GROUNDED_SEARCH_MAX_RESULTS_PER_COMPANY`
  - `BROWSER_USE_DISCOVERY_GROUNDED_SEARCH_MAX_PAGES_PER_COMPANY`
- Discovery worker startup sources:
  - `integrations/browser-use-discovery/.env` (webhook secret + discovery env)
  - `server/.env` (Gemini fallback via `ATS_GEMINI_API_KEY`)

## Worker state/config paths

- `integrations/browser-use-discovery/state/worker-config.json`
- `integrations/browser-use-discovery/state/worker-state.sqlite`

## Validation notes

- Validation mode is **real integrations only** (no mock fallback).
- Required proof includes: UI run initiation, webhook ack/run status lifecycle, and actual sheet write evidence.
- If credentials are missing/expired or external services are unavailable, workers must return to orchestrator with explicit blocker details.

## Security constraints

- Never commit service-account JSON, API keys, OAuth tokens, or full secrets.
- Treat values in `config.js`, `.env`, and local token files as sensitive.
- The provided service-account key is temporary and should be rotated by the user after mission completion.
