# Environment

Environment variables, external dependencies, and setup notes for this mission.

**What belongs here:** required env vars, local credential paths, external services, runtime assumptions, and setup caveats.  
**What does NOT belong here:** service ports/commands (use `.factory/services.yaml`).

---

## Primary external dependencies

- **Google Sheet (`Pipeline`)** is the system of record for pipeline data.
- **Google OAuth / Google Sheets API** are required for private-sheet access, writeback, and starter-sheet creation.
- **Discovery worker Sheets credentials** are required for real discovery writes.
- **ATS provider config** is required for live ATS scorecard requests.
- **Discovery grounded search config** is required when `grounded_web` is enabled in the worker.

## Local credential/runtime assumptions

- The mission uses the **current working tree** and the user’s already-configured local environment as baseline.
- `config.js` may contain local non-committed browser bootstrap config; workers must never commit secrets or local credentials.
- `server/.env` may exist for ATS server-mode credentials; workers must treat it as sensitive and avoid echoing or committing contents.
- The discovery worker may resolve config and state from:
  - `integrations/browser-use-discovery/state/worker-config.json`
  - `integrations/browser-use-discovery/state/worker-state.sqlite`
  - local token/service-account env vars or fallback token files
- `integrations/browser-use-discovery/state/worker-config.json` is a checked-in, non-secret seed config for the disposable validation sheet and starter company list; keep it aligned with the disposable sheet and never swap in production identifiers or credentials.

## Validation-specific notes

- Use the **disposable test sheet** for write validation.
- Real discovery validation is expected to write rows and may incur external API usage.
- Real ATS validation is expected to use the configured provider and may incur external API usage.
- If a worker determines that a failure is caused by missing or expired user credentials rather than code, return to orchestrator instead of patching around it.

## Validation sheet bootstrap for frontend-decomposition

When frontend-decomposition workers need representative pipeline data (for Daily Brief, board lanes, card rendering), use the validation bootstrap assets:

- `evidence/seed-pipeline-data.json` — 8 seed rows spanning all workflow stages (New, Researching, Applied, Phone Screen, Interviewing, Rejected, Passed) with realistic Scale AI / Figma / Notion entries. Sheet ID: `1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ`.
- `scripts/apply-validation-bootstrap.mjs` — Node script that verifies the seed data and prints browser application instructions.

Workers apply the bootstrap by either:
1. Setting `localStorage.setItem('command_center_config_overrides', JSON.stringify({ sheetId: '1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ' }))` in the browser console and reloading, or
2. Using the `setup-browser-cookies` skill to import an authenticated Google session for private-sheet access.

The `discovery-local-bootstrap.json` already points `sheetId` at this same disposable sheet. Frontend-decomposition browser assertions (VAL-DASH-001 through VAL-DASH-018) require populated board/brief data; this bootstrap ensures they don't fall back to setup-only state.

## Safety constraints

- Never print or commit access tokens, API keys, service-account JSON, or full secret-bearing config values.
- Never replace the disposable validation sheet with a production sheet without explicit user direction.
- Do not “fix” credential gaps by hardcoding secrets into source or checked-in config files.
