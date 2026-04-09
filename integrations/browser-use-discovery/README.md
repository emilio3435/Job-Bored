# Browser Use Discovery Worker

This package is a user-owned discovery worker for JobBored. It accepts the existing `command-center.discovery` webhook request, resolves jobs across Greenhouse, Lever, and Ashby, normalizes them into valid Pipeline rows, dedupes on column E `Link`, and writes directly to Google Sheets.

It is designed for both:
- hosted mode for general users
- local mode for advanced or privacy-sensitive setups

The runtime is Node-based, uses native `fetch`, can persist state locally, and keeps the existing dashboard webhook contract unchanged in v1.

## What It Exposes

- `src/server.ts`: local/hosted HTTP entrypoint with `GET /health` and webhook POST handling
- `src/webhook/handle-discovery-webhook.ts`: contract validation, CORS-friendly acknowledgement, sync/async handling
- `src/run/run-discovery.ts`: shared run pipeline for manual and scheduled discovery
- `src/browser/*`: first-layer Greenhouse, Lever, and Ashby adapter registry plus Browser Use session seam
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
- `BROWSER_USE_DISCOVERY_BROWSER_COMMAND`: optional Browser Use command; when unset or failing, adapters fall back to direct fetch
- `BROWSER_USE_DISCOVERY_GOOGLE_ACCESS_TOKEN`: optional bearer token for Sheets API
- `BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_JSON`: optional inline service-account JSON
- `BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE`: optional service-account JSON file path
- `BROWSER_USE_DISCOVERY_WEBHOOK_SECRET`: optional shared secret for the webhook layer

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
  "enabledSources": ["greenhouse", "lever", "ashby"],
  "schedule": {
    "enabled": false,
    "cron": "0 7 * * 1-5"
  }
}
```

In v1, the company list remains worker-owned. The dashboard webhook can narrow the run through `discoveryProfile`, but it does not become the source of truth for companies.

## Local Run

Example:

```bash
BROWSER_USE_DISCOVERY_RUN_MODE=local \
BROWSER_USE_DISCOVERY_CONFIG_PATH="$PWD/integrations/browser-use-discovery/state/worker-config.json" \
BROWSER_USE_DISCOVERY_STATE_DB_PATH="$PWD/integrations/browser-use-discovery/state/worker-state.sqlite" \
BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE="$PWD/service-account.json" \
node --experimental-strip-types integrations/browser-use-discovery/src/server.ts
```

Health check:

```bash
curl http://127.0.0.1:8644/health
```

The local wizard path in JobBored already expects a healthy local endpoint plus an optional tunnel/relay layer. This worker keeps that shape by exposing `/health` and a direct POST webhook path.

## Hosted Run

Hosted mode uses the same code path and contract. The difference is infrastructure and credential storage, not behavior:

- deploy the worker behind your own HTTPS URL
- set allowed origins for your dashboard URL
- provide a persistent config/state path
- provide a Google Sheets credential the worker can use directly

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
