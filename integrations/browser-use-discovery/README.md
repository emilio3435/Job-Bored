# Browser Use Discovery Worker

This package is a user-owned discovery worker for JobBored. It accepts the existing `command-center.discovery` webhook request, resolves jobs across Greenhouse, Lever, and Ashby, can optionally widen into Gemini Google Search grounding plus Browser Use, normalizes them into valid Pipeline rows, dedupes on column E `Link`, and writes directly to Google Sheets.

It is designed for both:

- hosted mode for general users
- local mode for advanced or privacy-sensitive setups

The runtime is Node-based, uses native `fetch`, can persist state locally, and keeps the existing dashboard webhook contract unchanged in v1.

## What It Exposes

- `src/server.ts`: local/hosted HTTP entrypoint with `GET /health` and webhook POST handling
- `src/webhook/handle-discovery-webhook.ts`: contract validation, CORS-friendly acknowledgement, sync/async handling
- `src/run/run-discovery.ts`: shared run pipeline for manual and scheduled discovery
- `src/browser/*`: first-layer Greenhouse, Lever, and Ashby adapter registry plus Browser Use session seam
- `src/grounding/grounded-search.ts`: Gemini Google Search grounding plus Browser Use extraction for broader web discovery
- `src/normalize/lead-normalizer.ts`: URL canonicalization, keyword-aware filtering, fit scoring, stable Pipeline defaults
- `src/sheets/pipeline-writer.ts`: direct Google Sheets writer with Link-based dedupe and conservative row updates
- `src/cleanup/expired-job-cleanup.ts`: dry-run-first expired posting checker that moves confirmed closed rows to `Status = Expired` and appends a Notes audit line

### Blacklist tab

The worker supports a sibling tab named `Blacklist` in the same spreadsheet.
When present, it is read as `Blacklist!A2:A` and normalized through the same
URL normalizer used for Pipeline dedupe.

Expected columns:

- `A URL`: normalized URL key
- `B Dismissed At`: ISO timestamp
- `C Title`: audit text
- `D Company`: audit text
- `E Reason`: reserved for future use

Behavior:

- incoming leads with URLs found in `Blacklist` are skipped (not appended)
- existing Pipeline rows with non-empty `Dismissed At` (column `W`) are treated
  as blacklisted and are not updated
- missing `Blacklist` tab is treated as empty (no error)
- the worker does not auto-create the `Blacklist` tab; the dashboard creates it
  on first dismiss action

### Expired job cleanup

Run from the repo root:

```bash
npm run cleanup:expired-jobs -- --sheet-id="$SHEET_ID"
```

The default is a dry run. Add `--write` to update the sheet. The cleanup checks
existing `Pipeline` rows by column E `Link`, writes only column M `Status` and
column O `Notes`, and only expires blank/New/Researching rows. Applied, Phone
Screen, Interviewing, Offer, Rejected, Passed, and already Expired rows are
protected. HTTP 403, captchas, timeouts, network failures, and ambiguous pages
are reported as needs-review.

Install the separate daily scheduler from the repo root:

```bash
npm run cleanup:expired-jobs:schedule:install -- --sheet-id "$SHEET_ID"
```

The default fire time is the installed discovery refresh time plus 45 minutes
(e.g. discovery at 08:15 → cleanup at 09:00). Pass `--hour` and `--minute` to
override. The scheduled runner is wrapped with a 45-minute total-timeout that
matches this post-discovery window. Scheduled cleanup defaults to dry-run and
writes its report to `state/expired-cleanup-schedule.log`. Add `--write` only
after reviewing dry-run accuracy. The scheduler uses distinct artifacts from
discovery refresh, such as the macOS label `com.jobbored.expired-cleanup`.

Operational commands:

```bash
# Inspect installed schedule + breadcrumb
npm run cleanup:expired-jobs:schedule:status

# Tail the most recent run log
tail -f integrations/browser-use-discovery/state/expired-cleanup-schedule.log

# Switch scheduled cleanup from dry-run to write
npm run cleanup:expired-jobs:schedule:install -- --sheet-id "$SHEET_ID" --write --force

# Remove the schedule entirely
npm run cleanup:expired-jobs:schedule:uninstall
```

When cleanup classifies a row as `needs_review`, write mode appends a one-sentence
audit line in plain English to column O Notes, e.g.
`[JobBored 2026-05-26] Please review this job — the site blocked us before we could read the page (HTTP 403).`
Confirmed-expired rows get a matching `Marked Expired because <reason>. Was: <previousStatus>.`
line and have column M flipped to `Expired`. The dashboard review modal reads
those notes plus aging New/Researching rows and renders every match with a
direct link to the job posting plus per-row actions (`Mark Expired`,
`Dismiss`, `Set Researching`) and a bulk select bar.

### POST /cleanup-expired (dashboard helper)

The worker also exposes `POST /cleanup-expired` for the dashboard's **Run
cleanup now** button. It accepts the same `x-discovery-secret` header as
`/discovery`, runs the cleanup synchronously, and returns the counts plus the
full result list:

```jsonc
// Request
{ "sheetId": "1mGJ04E…", "dryRun": false, "googleAccessToken": "ya29.…" }

// Response (200)
{
  "ok": true,
  "sheetId": "1mGJ04E…",
  "dryRun": false,
  "checked": 94,
  "open": 37,
  "needsReview": 57,
  "skipped": 60,
  "wouldExpire": 0,
  "updated": 0,
  "results": [ { "rowNumber": 12, "action": "needs_review", "reason": "…" }, ... ]
}
```

Like `/discovery`, the per-request `googleAccessToken` is isolated to a per-call
runtime config and never persisted on disk.

## Runtime Inputs

Environment variables:

- `BROWSER_USE_DISCOVERY_RUN_MODE`: `local` or `hosted`
- `BROWSER_USE_DISCOVERY_PORT`: HTTP port, defaults to `8644`
- `BROWSER_USE_DISCOVERY_HOST`: bind host, defaults to `127.0.0.1`
- `BROWSER_USE_DISCOVERY_ALLOWED_ORIGINS`: comma/newline/semicolon-separated allowed origins
- `BROWSER_USE_DISCOVERY_ASYNC_ACK`: `true` by default
- `BROWSER_USE_DISCOVERY_MAX_RUN_DURATION_MS`: async run watchdog, defaults to `3600000` (60 minutes)
- `BROWSER_USE_DISCOVERY_WORKER_CONFIG` / `BROWSER_USE_DISCOVERY_CONFIG_PATH`: path to worker config JSON, defaults to `~/.jobbored/browser-use-discovery/worker-config.json`
- `BROWSER_USE_DISCOVERY_WORKER_ENV` / `BROWSER_USE_DISCOVERY_ENV_FILE`: path to the ignored local env file, defaults to `~/.jobbored/browser-use-discovery/.env`
- `BROWSER_USE_DISCOVERY_STATE_DB_PATH`: path to the worker state database
- `BROWSER_USE_DISCOVERY_BROWSER_COMMAND`: optional browser automation command; when unset, the worker first tries the bundled `integrations/browser-use-discovery/bin/browser-use-agent-browser.mjs` wrapper if it exists, then falls back to plain `browser-use`, and finally falls back to direct fetch on command failure
- `BROWSER_USE_DISCOVERY_LLM_PROVIDER`: generic chat/JSON LLM provider; use `openrouter` as the setup default, or select `local`, `openai`, `openai_compatible`, `anthropic`, or `gemini`
- `BROWSER_USE_DISCOVERY_OPENROUTER_API_KEY` / `_MODEL` / `_BASE_URL`: OpenRouter generic LLM config
- `BROWSER_USE_DISCOVERY_LOCAL_API_KEY` / `_MODEL` / `_BASE_URL`: local generic LLM config; API key is optional for Ollama-style servers
- `BROWSER_USE_DISCOVERY_OPENAI_API_KEY` / `_MODEL` / `_BASE_URL`: OpenAI generic LLM config
- `BROWSER_USE_DISCOVERY_ANTHROPIC_API_KEY` / `_MODEL` / `_BASE_URL`: Anthropic generic LLM config
- `BROWSER_USE_DISCOVERY_LLM_GEMINI_API_KEY` / `_MODEL` / `_BASE_URL`: Gemini as the selected generic LLM provider
- `BROWSER_USE_DISCOVERY_GEMINI_API_KEY`: optional key for Gemini Google Search (grounded web) and URL Context; also accepted as a backwards-compatible Gemini LLM key when `LLM_PROVIDER=gemini` and the `LLM_GEMINI_API_KEY` alias is unset (prefer the alias)
- `BROWSER_USE_DISCOVERY_GEMINI_MODEL`: Gemini model for grounded search and Add URL context extraction, defaults to `gemini-3.5-flash`
- `BROWSER_USE_DISCOVERY_GROUNDED_SEARCH_MAX_RESULTS_PER_COMPANY`: candidate links to keep per company, defaults to `6`
- `BROWSER_USE_DISCOVERY_GROUNDED_SEARCH_MAX_PAGES_PER_COMPANY`: grounded pages to expand per company, defaults to `4`
- `SERPAPI_API_KEY` (also read as `BROWSER_USE_DISCOVERY_SERPAPI_API_KEY` or `DISCOVERY_SERPAPI_API_KEY`): **strongly recommended.** Enables the `serpapi_google_jobs` source lane which queries Google Jobs directly — structured `title/company/location/description/apply_url` data with no scraping step. Free tier: 100 searches/month (~20 discovery runs). Developer tier: $50/mo for 5K. Lane is feature-gated: skips gracefully when unset. Get a key at https://serpapi.com/
- `BROWSER_USE_API_KEY`: optional Browser Use Cloud API key for Add job from URL fallback. Used only after ATS, Gemini URL context, and Cheerio extraction are blocked, fail, or return weak content.
- `BROWSER_USE_PROFILE_ID`: optional Browser Use Cloud profile id for authenticated Add job from URL extraction. Browser Use profiles preserve cookies/local storage across sessions; create or sync a profile that is already signed in to the target job board, then set this id. The worker passes it to Browser Use Cloud, but still rejects source-gated or placeholder output instead of writing junk rows.
- `BROWSER_USE_DISCOVERY_GOOGLE_ACCESS_TOKEN`: optional bearer token for Sheets API
- `BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_JSON`: optional inline service-account JSON
- `BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE`: optional service-account JSON file path
- `BROWSER_USE_DISCOVERY_GOOGLE_OAUTH_TOKEN_JSON`: optional inline Google OAuth token JSON
- `BROWSER_USE_DISCOVERY_GOOGLE_OAUTH_TOKEN_FILE`: optional Google OAuth token JSON file path
- `BROWSER_USE_DISCOVERY_WEBHOOK_SECRET`: optional shared secret for the webhook layer

### Google Sheets credential precedence

The worker resolves Google Sheets credentials in this order at request time
(highest first):

1. **`googleAccessToken` in the discovery request body** — the dashboard sends
   its current GIS sign-in token automatically. **Users who run discovery
   from a signed-in JobBored tab need none of the env vars below.** Per-request
   only; never persisted; stripped from the run-status store.
2. `BROWSER_USE_DISCOVERY_GOOGLE_ACCESS_TOKEN` — raw access token in env.
3. `BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_JSON` / `_FILE` — recommended
   for unattended/cron runs. Never expires, no re-auth dance, no user session
   required. Share the destination Sheet with the service account email.
4. `BROWSER_USE_DISCOVERY_GOOGLE_OAUTH_TOKEN_JSON` / `_FILE` — refreshable
   personal OAuth token; works for long-running personal setups but eventually
   needs renewal.

The two paths most users care about:

- **Zero-touch (interactive)**: sign in to JobBored, click Run discovery. The
  dashboard's existing Google Sheets token rides along on the request and the
  worker uses it. No env wiring required.
- **Power-user (unattended)**: set
  `BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE` to a service-account
  JSON. Cron jobs and headless trigger paths will work without any user
  session. The dashboard path still works in parallel because the per-request
  token takes precedence when present.

Worker config JSON:

```json
{
  "sheetId": "your-sheet-id",
  "mode": "hosted",
  "timezone": "America/Chicago",
  "companies": [
    {
      "name": "Example Co",
      "includeKeywords": ["TypeScript", "Node"],
      "excludeKeywords": ["WordPress"],
      "boardHints": {
        "greenhouse": "exampleco",
        "lever": "exampleco",
        "ashby": "exampleco"
      }
    }
  ],
  "includeKeywords": ["browser automation", "platform"],
  "excludeKeywords": ["wordpress"],
  "targetRoles": ["Platform Engineer", "Backend Engineer"],
  "locations": ["Remote", "Austin"],
  "remotePolicy": "remote-first",
  "seniority": "senior",
  "maxLeadsPerRun": 15,
  "enabledSources": ["greenhouse", "lever", "ashby", "grounded_web"],
  "schedule": {
    "enabled": false,
    "cron": "0 7 * * 1-5"
  }
}
```

In v1, the company list remains worker-owned. The dashboard webhook can narrow the run through `discoveryProfile`, but it does not become the source of truth for companies.

ATS adapters still handle Greenhouse, Lever, and Ashby directly. `grounded_web` is a separate lane that asks Gemini with Google Search grounding for fresh links, then uses Browser Use to expand those pages into detailed listings before normalization and dedupe.

## Local Run

Example:

```bash
npm run setup:discovery

BROWSER_USE_DISCOVERY_RUN_MODE=local \
BROWSER_USE_DISCOVERY_WORKER_CONFIG="$HOME/.jobbored/browser-use-discovery/worker-config.json" \
BROWSER_USE_DISCOVERY_WORKER_ENV="$HOME/.jobbored/browser-use-discovery/.env" \
BROWSER_USE_DISCOVERY_CONFIG_PATH="$HOME/.jobbored/browser-use-discovery/worker-config.json" \
BROWSER_USE_DISCOVERY_STATE_DB_PATH="$HOME/.jobbored/browser-use-discovery/worker-state.sqlite" \
BROWSER_USE_DISCOVERY_BROWSER_COMMAND="$PWD/integrations/browser-use-discovery/bin/browser-use-agent-browser.mjs" \
BROWSER_USE_DISCOVERY_LLM_PROVIDER=openrouter \
BROWSER_USE_DISCOVERY_OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE="$PWD/service-account.json" \
node --experimental-strip-types integrations/browser-use-discovery/src/server.ts
```

Add `BROWSER_USE_DISCOVERY_GEMINI_API_KEY` only when you want the optional
Gemini Google Search grounding or URL Context tiers.

The repo-level `integrations/browser-use-discovery/package.json` is a script
surface only; root `package-lock.json` owns dependency installation for the
worker. Do not commit a nested `integrations/browser-use-discovery/package-lock.json`.

The bundled `browser-use-agent-browser.mjs` adapter wraps the local `agent-browser`
CLI and speaks the worker's JSON-over-stdin/stdout contract. When
`BROWSER_USE_DISCOVERY_BROWSER_COMMAND` is unset, the runtime now auto-selects
this bundled wrapper if the file exists. The wrapper looks for `agent-browser`
on `PATH`, `AGENT_BROWSER_PATH`, or the local default install at
`~/.factory/tools/agent-browser/bin/agent-browser`.

Health check:

```bash
curl http://127.0.0.1:8644/health
```

The local wizard path in JobBored already expects a healthy local endpoint plus an optional tunnel/relay layer. This worker keeps that shape by exposing `/health` and a direct POST webhook path.

When `BROWSER_USE_DISCOVERY_RUN_MODE=local`, the worker also falls back to
`~/.hermes/google_token.json` if no explicit Sheets credential is configured.
That keeps local verification unblocked after a Hermes Sheets re-auth, while a
service account remains the better long-term hosted credential.

## Hosted Run

Hosted mode uses the same code path and contract. The difference is infrastructure and credential storage, not behavior:

- deploy the worker behind your own HTTPS URL
- set allowed origins for your dashboard URL
- provide a persistent config/state path
- provide a Google Sheets credential the worker can use directly

### POST /ingest-url

`POST /ingest-url` accepts a single pasted job URL and attempts a tiered ingest strategy that writes one normalized Pipeline row, falling through each tier only when the prior one cannot return a complete posting:

1. **ATS public API** (`ats_api`) — when the URL parses to a known Greenhouse/Lever/Ashby posting.
2. **Gemini URL context** (`gemini_url_context`) — optional Google-tool tier where Gemini reads the live page with the `url_context` tool and returns structured job fields. Uses `BROWSER_USE_DISCOVERY_GEMINI_API_KEY` and `BROWSER_USE_DISCOVERY_GEMINI_MODEL` (default `gemini-3.5-flash`) only when configured. Skipped when the key is unset, and weak/low-confidence output falls through to Cheerio.
3. **JSON-LD / DOM scrape** (`jsonld` / `cheerio_dom`) — via the shared Cheerio scraper.
4. **Browser Use Cloud** (`browser_use_cloud`) — fallback for blocked aggregators, failed scrapes, or weak extraction.

If the worker cannot extract a real title, company, and posting body, it rejects the add instead of landing a placeholder Kanban card.

```ts
POST /ingest-url
Content-Type: application/json

Body IngestUrlRequestV1:
{
  event: "ingest.url.request",
  schemaVersion: 1,
  url: string,
  sheetId?: string,
  async?: boolean,  // return accepted_async and expose final result on statusPath
  manual?: {
    title: string,
    company: string,
    location?: string,
    description?: string,
    fitScore?: number   // 0-10
  }
}

Response IngestUrlResponseV1 (HTTP 200 unless server-side 5xx):
  | { ok: true, kind: "accepted_async", runId: string, statusPath: string, pollAfterMs: number, message: string }
  | { ok: true, strategy: "ats_api"|"gemini_url_context"|"jsonld"|"cheerio_dom"|"manual_fill"|"url_only"|"browser_use_cloud", lead: NormalizedLead, appended: boolean, rowNumber?: number }
  | { ok: false, reason: "invalid_url", message: string }
  | { ok: false, reason: "private_network", message: string }
  | { ok: false, reason: "blocked_aggregator", host: string, message: string, hint: string }
  | { ok: false, reason: "scrape_failed", httpStatus?: number, message: string, hint: string }
  | { ok: false, reason: "low_quality_extraction", message: string, hint: string }
  | { ok: false, reason: "duplicate", rowNumber: number, message: string }
  | { ok: false, reason: "worker_error", message: string }
```

When `async:true`, poll the returned `statusPath` until `terminal:true`; the final `DiscoveryRunStatusPayload.ingestResult` contains one of the non-async response shapes above. Hosted workers may include a `statusToken` query parameter in `statusPath`; preserve it exactly.

LinkedIn / Indeed / Glassdoor / ZipRecruiter are classified as blocked aggregators. The worker skips direct Cheerio scraping for those hosts, tries Browser Use Cloud when `BROWSER_USE_API_KEY` is configured, and rejects the add when the page is still source-gated or only yields placeholder fields. Prefer employer-hosted career pages or ATS links when a job board hides the posting.

## Testing

Browser-scope tests:

```bash
node --experimental-strip-types --test integrations/browser-use-discovery/tests/browser/*.test.ts
```

Sheets/normalization tests:

```bash
node --experimental-strip-types --test integrations/browser-use-discovery/tests/sheets/*.test.ts
```

Webhook and end-to-end coverage live under `tests/webhook/` and `tests/e2e/`.
