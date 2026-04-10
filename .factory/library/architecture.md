# Architecture

## System overview
JobBored is organized around one shared data plane: the user's Google Sheet. The browser app is the primary product surface and everything else augments that sheet-centric loop rather than replacing it with a second database.

Current active surfaces:
- **Dashboard board/drawer** for Daily Brief, stage lanes, job detail, and sheet writeback
- **Settings/auth** for sheet selection, OAuth bootstrap, discovery/scraper/ATS/provider config, and starter-sheet creation
- **Discovery browser path + worker** for guided setup, browser-triggered discovery POSTs, and worker-owned sourcing/writes
- **Local scraper/ATS** for posting enrichment and scorecard analysis
- **Onboarding/profile/drafts** for resume capture, candidate context, draft generation, saved versions, and ATS-in-draft flow

Dashboard-side persistent state is split across three primary places:
- **Google Sheet (`Pipeline`)**: shared system of record for job rows
- **Browser `localStorage`**: config overrides, OAuth session reuse, viewed/enrichment caches, lightweight discovery transport state
- **Browser IndexedDB**: onboarding completion, portfolio/profile materials, discovery preferences/wizard state, generated draft history

There is also operator-owned runtime state outside the browser:
- **Worker/server-owned state and env config**: discovery worker state/config files under `integrations/browser-use-discovery/state/`, ATS env-backed server config, and other local credential/runtime inputs that are not browser-managed.

The refactor should preserve the current product shape: a static browser-first dashboard that reads/writes the user's sheet directly, with optional local/hosted helper services for enrichment, ATS scoring, and discovery.

## Major components
### Pipeline sheet data plane
- **Responsibility:** Hold the canonical pipeline rows that every other surface reads from or writes to.
- **Depends on:** Google Sheets, the published pipeline contract, dashboard readers/writers, discovery workers, and starter-sheet creation flow.
- **Stability constraints:** `Pipeline` remains the system of record; the header contract must stay aligned; row identity is anchored on canonicalized job `Link`; discovery updates must not duplicate rows or overwrite user-owned workflow fields.

### Dashboard board and drawer
- **Responsibility:** Render the Daily Brief, stage-ordered board lanes, search/sort/filter state, job drawer, and in-place CRM edits.
- **Depends on:** `index.html`, `app.js`, `style.css`, pipeline rows from Google Sheets, auth state, enrichment state, and draft/profile caches.
- **Stability constraints:** Board lanes stay in canonical workflow order; search narrows the board without recomputing the brief; the drawer must stay attached to the active job across refreshes and saves; signed-out users keep readable browse access while write controls stay gated.

### Settings and auth shell
- **Responsibility:** Own the six-tab settings surface, OAuth bootstrap, starter-sheet creation, saved config overrides, Apps Script stub deploy, and provider endpoint selection.
- **Depends on:** `config.js`, browser `localStorage`, Google Identity Services, Google Sheets API, and IndexedDB-backed discovery/profile state.
- **Stability constraints:** Settings keeps the current six-tab shell and save/reload behavior; OAuth can bootstrap without a sheet ID; changing the OAuth client ID invalidates cached session reuse; clearing saved settings must not erase IndexedDB-backed portfolio or draft data.

### Discovery browser path
- **Responsibility:** Guide the user to a valid discovery endpoint, validate browser-safe discovery routes, store discovery preferences, and send the `command-center.discovery` POST from the browser.
- **Depends on:** Settings, discovery wizard helpers, local bootstrap JSON, browser-stored discovery profile/state, and the v1 webhook contract.
- **Stability constraints:** Missing discovery config opens setup instead of posting; test/run flows must classify outcomes consistently; browser-facing endpoints must remain public HTTPS roots that support CORS; deferred discovery intent must survive onboarding/setup handoffs.

### Discovery worker
- **Responsibility:** Accept discovery webhook requests, resolve worker-owned company/source config, collect listings, normalize/match/filter them, dedupe them, and write valid rows back to the sheet.
- **Depends on:** `integrations/browser-use-discovery/` runtime config, source adapters, optional Browser Use + Gemini services, worker state/config files, and Google Sheets credentials.
- **Stability constraints:** The worker must keep the dashboard webhook contract stable in v1; `/health` and CORS behavior must remain browser-consumable; dedupe is Link-based; async acceptance must still lead to an observable completion outcome; worker-owned company config remains the source of truth for targeted companies.

### Local scraper and ATS service
- **Responsibility:** Provide `/health`, `/api/scrape-job`, and `/api/ats-scorecard` so the browser can enrich postings and score active drafts against the job context.
- **Depends on:** `server/`, Cheerio scraping logic, ATS provider config from env, and optional deployed HTTPS hosting for non-local use.
- **Stability constraints:** Localhost defaults must keep working for local development; HTTPS dashboards must not silently use unsafe local HTTP endpoints; malformed scrape/ATS requests must fail clearly; successful posting enrichment must flow into later ATS requests.

### Onboarding, profile, and drafts
- **Responsibility:** Capture resume/profile context, gate drafting until minimum candidate context exists, generate cover-letter/resume drafts, store draft versions, and surface saved history across job surfaces and the draft modal.
- **Depends on:** `user-content-store.js` IndexedDB stores, active job context from the dashboard, optional posting enrichment, selected AI provider or webhook, and ATS transport selection.
- **Stability constraints:** Onboarding/profile data stays local to the browser; finishing onboarding persists the primary resume and preferences; generation creates versioned drafts instead of overwriting; saved drafts must reopen from stored snapshots even when the live job row changes or disappears.

### Contracts and validation layer
- **Responsibility:** Define and verify the stable contracts shared by the browser app, sheet model, discovery worker, ATS payloads, and integration paths.
- **Depends on:** `AGENT_CONTRACT.md`, `schemas/`, `examples/`, and the contract test scripts in `scripts/test-*.mjs`.
- **Stability constraints:** Refactors must keep runtime behavior, examples, schemas, and documented sheet/webhook contracts aligned so that validation remains trustworthy and contract drift is caught early.

### Optional BYOK integrations and templates
- **Responsibility:** Provide alternative user-owned receivers, relays, and automation entry points around the same core sheet/webhook contracts.
- **Depends on:** `integrations/apps-script`, `integrations/openclaw-command-center`, `integrations/n8n`, and `templates/`.
- **Stability constraints:** These paths are adapters around the same stable contracts; refactors to core discovery or sheet behavior must not silently break them.

## Core data flows
1. **Startup and access:** The browser merges `config.js` with saved overrides, resolves sheet/auth state, then routes the user through sheet access, starter-sheet setup, onboarding, or the dashboard shell.
2. **Read path:** The dashboard loads `Pipeline` rows from Google Sheets, computes the Daily Brief from the full dataset, renders board lanes from the current filtered/sorted view, and opens the drawer against a stable active job identity.
3. **Writeback path:** Signed-in edits from the drawer or board post to Google Sheets, then refresh local dashboard state so the board, brief, and open drawer stay synchronized to the same role.
4. **Discovery path:** Settings/wizard state plus IndexedDB discovery preferences produce a `command-center.discovery` v1 POST; the receiving worker or external automation writes appended/updated rows to the sheet; the dashboard later picks those rows up through its normal refresh loop.
5. **Local discovery bootstrap path:** Local bootstrap output, tunnel detection, and Cloudflare relay guidance flow into the discovery wizard so the browser saves a public worker/root endpoint instead of a localhost-only target.
6. **Posting enrichment path:** A job surface requests `/api/scrape-job` (or an equivalent deployed scraper), the returned structured posting data is cached locally and rendered in the drawer, and that enriched context becomes available to downstream draft and ATS flows.
7. **Drafting and ATS path:** Profile data from IndexedDB plus the active job row and optional posting enrichment are sent to the selected generation transport; the returned draft is saved as a versioned local artifact; ATS analysis then runs against the active draft text and current job/posting context.

## Invariants to preserve
- The user's Google Sheet remains the only shared durable system of record for job pipeline data.
- The dashboard remains useful in read-only mode without sign-in; auth only unlocks private-sheet access and write actions.
- The `Pipeline` contract, starter-sheet header order, and Link-based row identity stay stable across browser, docs, and discovery worker surfaces.
- Daily Brief metrics are computed from the full pipeline, not from the current board filter/search subset.
- The dashboard board and drawer always refer to the same active role after re-renders, saves, enrichment loads, and draft actions.
- Discovery request payloads stay on the published `command-center.discovery` v1 contract unless a deliberate contract migration is made.
- Discovery refreshes must preserve user-owned workflow state such as status, applied date, notes, follow-up, last contact, and reply.
- Browser-local data remains intentionally separated: config/session caches in `localStorage`, profile/discovery/drafts in IndexedDB.
- `Clear saved settings` only clears config overrides and related lightweight browser state; it does not erase portfolio materials or draft history.
- Posting enrichment, ATS, and discovery are optional augmentations: failures must degrade visibly and recoverably without breaking the base dashboard/browse flow.
- Worker-owned targeting/config remains authoritative for discovery runs; browser-sent discovery preferences only narrow or bias a run in v1.

## Refactor hotspots
- **`app.js`** is the dominant orchestration hotspot because it mixes config, auth, dashboard rendering, settings, discovery setup, onboarding, enrichment, ATS, and draft lifecycle in one global surface.
- **Browser shell and styling** are tightly coupled to the active browser surfaces and selector contracts, so visual/layout refactors can easily break board, drawer, settings, onboarding, or modal behavior together.
- **Discovery browser helpers and scripts** duplicate endpoint classification, bootstrap, tunnel, relay, and verification logic across browser and CLI paths, making drift likely during extraction.
- **The discovery worker run path** concentrates sourcing, matching, normalization, dedupe, and sheet writes, so refactors here risk contract drift or workflow-field loss if seams are not introduced carefully.
- **The local scraper/ATS server** is a high-risk boundary because network behavior, endpoint normalization, and provider failures directly affect drawer, draft, and ATS user flows.
- **Contract ownership is fragmented** across docs, schemas, browser code, and worker code, so refactors must keep those surfaces aligned or validation will regress even if runtime behavior looks correct.
