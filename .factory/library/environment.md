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

**Note:** `seed-pipeline-data.json` references a schema URL (`https://github.com/job-bored/command-center/schemas/pipeline-row.v1.json`) that may not exist at that GitHub location. The local schema file exists at `schemas/pipeline-row.v1.json` with matching `$id`. Workers should use local schema validation rather than attempting remote fetch.

Frontend-decomposition browser assertions (VAL-DASH-001 through VAL-DASH-018) require populated board/brief data; this bootstrap ensures they don't fall back to setup-only state.

## Dashboard validation fixtures

The `frontend-decomposition` milestone uses three fixture variants that workers switch between deterministically:

### Fixture: populated (default for most assertions)
- **File:** `evidence/seed-pipeline-data-populated.json`
- **Sheet ID:** `1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ` (same disposable sheet)
- **Use for:** VAL-DASH-001, VAL-DASH-003, VAL-DASH-004, VAL-DASH-005, VAL-DASH-006, VAL-DASH-007, VAL-DASH-008, VAL-DASH-012, VAL-DASH-014, VAL-DASH-015, VAL-DASH-016

### Fixture: populated + activity feed items (VAL-DASH-002)
- **Use for:** VAL-DASH-002 (clickable activity feed items → open drawer)
- **Requirement:** Activity feed requires at least one of: overdue `followUpDate` (before today), OR `responseFlag="Yes"` with `status` including "Interviewing"/"Phone Screen", OR stale `appliedDate` (>14 days old)
- **Current state:** The base populated fixture has followUpDate values AFTER today (2026-04-10) → shows "All clear" (empty feed)
- **Fix:** Add rows with past `followUpDate` to the sheet directly, or use the `manage-validation-fixtures.mjs` script to understand the requirements
- **Management script:** `node scripts/manage-validation-fixtures.mjs apply populated`

### Fixture: empty pipeline (VAL-DASH-013)
- **File:** `evidence/seed-pipeline-data-empty.json`
- **Sheet ID:** `EMPTY_PIPELINE_SHEET_ID_PLACEHOLDER` (must be replaced with a real empty spreadsheet)
- **Use for:** VAL-DASH-013 (truly empty pipeline → shows guided empty-state instead of blank chrome)
- **Note:** Create a new Google Sheet with only the Pipeline header row (no data rows). Replace the placeholder in the fixture file.

### Fixture: enriched jobs (VAL-DASH-017)
- **Use for:** VAL-DASH-017 (drawer enrichment lifecycle)
- **Requirement:** Jobs with valid `Link` URLs pointing to public job boards (Greenhouse/Ashby) that the scraper can fetch
- **Eligible jobs in populated fixture:** Performance Marketing Manager (Scale AI), Growth Marketing Lead (Figma), Marketing Operations Manager (Notion) — all have valid Greenhouse/Ashby URLs
- **Note:** VAL-DASH-017 also requires bypassing or completing the onboarding panel to access job cards

## Authenticated browser state for write assertions

The following assertions require a Google-authenticated browser session with write access to the validation sheet:
- VAL-DASH-009 (signed-in CRM field edits)
- VAL-DASH-010 (status changes → lane move)
- VAL-DASH-011 (follow-up date → overdue signal)
- VAL-DASH-018 (in-drawer saves → drawer stays in sync)

### Setup via cookie import
Use the `setup-browser-cookies` skill to import an authenticated Chromium Google session:
```
/setup-browser-cookies
```
Select the Google domains needed for Sheets API access. After import, the browser session has write access.

### Setup via live sign-in
In the validator browser session:
1. Navigate to `http://localhost:8080`
2. Click "Sign in with Google" in Settings → Sheet tab
3. Complete the OAuth flow with your Google account
4. The session gains write-capable dashboard controls

### Switching between fixtures
Dashboard checks switch between populated and empty fixtures deterministically:
```javascript
// Apply populated fixture
localStorage.setItem('command_center_config_overrides', JSON.stringify({ sheetId: '1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ' }));

// Apply empty fixture  
localStorage.setItem('command_center_config_overrides', JSON.stringify({ sheetId: 'YOUR_EMPTY_SHEET_ID' }));
// Then reload
```
Use the management script for fixture-switching guidance:
```
node scripts/manage-validation-fixtures.mjs list
node scripts/manage-validation-fixtures.mjs apply populated
node scripts/manage-validation-fixtures.mjs apply empty
```

## Safety constraints

- Never print or commit access tokens, API keys, service-account JSON, or full secret-bearing config values.
- Never replace the disposable validation sheet with a production sheet without explicit user direction.
- Do not “fix” credential gaps by hardcoding secrets into source or checked-in config files.
