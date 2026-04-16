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
- Do not hardcode credential file paths in committed manifests; read from `.env` at runtime

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

## Browser runtime env var aliases

The browser-use discovery runtime recognizes two env var names for the same configuration:

- `BROWSER_USE_DISCOVERY_BROWSER_COMMAND` (primary, discovery-specific)
- `BROWSER_USE_COMMAND` (shorter alias, also recognized)

Both point to the same underlying configuration. Remediation messages in runtime-readiness output reference both forms so users on either naming convention get actionable guidance.

- `integrations/browser-use-discovery/state/worker-config.json`
- `integrations/browser-use-discovery/state/worker-state.sqlite`

## Public relay dependency

- Public webhook smoke URL is user-provided and may change between sessions.
- Treat relay URL availability as an external dependency; if unavailable, return blocker to orchestrator.

## Tooling caveat: typecheck:repo

- `npm run typecheck:repo` runs `node --check` (JavaScript syntax validation only), NOT TypeScript type checking.
- The project uses `--experimental-strip-types` at runtime, which silently strips TS types without validating them.
- Type contract mismatches (e.g., declared type vs. actual assignment shape) are NOT caught by the current typecheck command.
- Workers should manually verify type consistency in `.ts` files, especially for exported interfaces and contract shapes.

## Validation notes

- Validation mode is **real integrations only** (no mock fallback).
- Required proof includes: UI run initiation, webhook ack/run status lifecycle, and actual sheet write evidence.
- If credentials are missing/expired or external services are unavailable, workers must return to orchestrator with explicit blocker details.

## Security constraints

- Never commit service-account JSON, API keys, OAuth tokens, or full secrets.
- Treat values in `config.js`, `.env`, and local token files as sensitive.
- Never paste private keys or token material into commits, test fixtures, or handoff notes.
