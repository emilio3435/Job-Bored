# Browser Use Discovery Worker

This package is a user-owned discovery worker for JobBored. It accepts the existing `command-center.discovery` webhook request, resolves jobs across Greenhouse, Lever, and Ashby, can widen into grounded web discovery through Gemini plus Browser Use, normalizes them into valid Pipeline rows, dedupes on column E `Link`, and writes directly to Google Sheets.

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

## Runtime Inputs

Environment variables:

- `BROWSER_USE_DISCOVERY_RUN_MODE`: `local` or `hosted`
- `BROWSER_USE_DISCOVERY_PORT`: HTTP port, defaults to `8644`
- `BROWSER_USE_DISCOVERY_HOST`: bind host, defaults to `127.0.0.1`
- `BROWSER_USE_DISCOVERY_ALLOWED_ORIGINS`: comma/newline/semicolon-separated allowed origins
- `BROWSER_USE_DISCOVERY_ASYNC_ACK`: `true` by default
- `BROWSER_USE_DISCOVERY_CONFIG_PATH`: path to worker config JSON
- `BROWSER_USE_DISCOVERY_STATE_DB_PATH`: path to the worker state database
- `BROWSER_USE_DISCOVERY_BROWSER_COMMAND`: optional browser automation command; when unset, the worker first tries the bundled `integrations/browser-use-discovery/bin/browser-use-agent-browser.mjs` wrapper if it exists, then falls back to plain `browser-use`, and finally falls back to direct fetch on command failure
- `BROWSER_USE_DISCOVERY_GEMINI_API_KEY`: optional Gemini key for grounded Google Search expansion
- `BROWSER_USE_DISCOVERY_GEMINI_MODEL`: Gemini model for grounded search, defaults to `gemini-2.5-flash`
- `BROWSER_USE_DISCOVERY_GROUNDED_SEARCH_MAX_RESULTS_PER_COMPANY`: candidate links to keep per company, defaults to `6`
- `BROWSER_USE_DISCOVERY_GROUNDED_SEARCH_MAX_PAGES_PER_COMPANY`: grounded pages to expand per company, defaults to `4`
- `SERPAPI_API_KEY` (also read as `BROWSER_USE_DISCOVERY_SERPAPI_API_KEY` or `DISCOVERY_SERPAPI_API_KEY`): **strongly recommended.** Enables the `serpapi_google_jobs` source lane which queries Google Jobs directly — structured `title/company/location/description/apply_url` data with no scraping step. Free tier: 100 searches/month (~20 discovery runs). Developer tier: $50/mo for 5K. Lane is feature-gated: skips gracefully when unset. Get a key at https://serpapi.com/
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
  "maxLeadsPerRun": 25,
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
BROWSER_USE_DISCOVERY_RUN_MODE=local \
BROWSER_USE_DISCOVERY_CONFIG_PATH="$PWD/integrations/browser-use-discovery/state/worker-config.json" \
BROWSER_USE_DISCOVERY_STATE_DB_PATH="$PWD/integrations/browser-use-discovery/state/worker-state.sqlite" \
BROWSER_USE_DISCOVERY_BROWSER_COMMAND="$PWD/integrations/browser-use-discovery/bin/browser-use-agent-browser.mjs" \
BROWSER_USE_DISCOVERY_GEMINI_API_KEY="$GEMINI_API_KEY" \
BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE="$PWD/service-account.json" \
node --experimental-strip-types integrations/browser-use-discovery/src/server.ts
```

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

`POST /ingest-url` accepts a single pasted job URL and attempts a tiered ingest strategy that writes one normalized Pipeline row: ATS public API first (when parsable), then JSON-LD/DOM extraction via the shared Cheerio scraper, with an explicit blocked-aggregator response for known anti-scraping boards.

```ts
POST /ingest-url
Content-Type: application/json

Body IngestUrlRequestV1:
{
  event: "ingest.url.request",
  schemaVersion: 1,
  url: string,
  sheetId?: string,
  manual?: {
    title: string,
    company: string,
    location?: string,
    description?: string,
    fitScore?: number   // 0-10
  }
}

Response IngestUrlResponseV1 (HTTP 200 unless server-side 5xx):
  | { ok: true, strategy: "ats_api"|"jsonld"|"cheerio_dom"|"manual_fill", lead: NormalizedLead, appended: boolean, rowNumber?: number }
  | { ok: false, reason: "invalid_url", message: string }
  | { ok: false, reason: "private_network", message: string }
  | { ok: false, reason: "blocked_aggregator", host: string, message: string }
  | { ok: false, reason: "scrape_failed", httpStatus?: number, message: string, hint: string }
  | { ok: false, reason: "duplicate", rowNumber: number, message: string }
  | { ok: false, reason: "worker_error", message: string }
```

LinkedIn / Indeed / Glassdoor / ZipRecruiter return `blocked_aggregator` — the dashboard surfaces a manual-fill modal for these; do not attempt to scrape them.

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
