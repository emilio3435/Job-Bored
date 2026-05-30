# Discovery worker endpoints

Full route list for `integrations/browser-use-discovery/src/server.ts`. Default base: `http://127.0.0.1:8644`.

## Routes

### `GET /health`

```json
{
  "ok": true,
  "version": "...",
  "endpoints": {
    "health": "/health",
    "runs": "/runs/{runId}",
    "discovery": "/discovery",
    "discoveryProfile": "/discovery-profile",
    "ingestUrl": "/ingest-url",
    "cleanupExpired": "/cleanup-expired"
  }
}
```

No auth required. The dashboard uses `/health` to confirm the worker is up before allowing manual discovery dispatch.

### `POST /discovery` (aliases: `POST /webhook`, `POST /`)

The main entry. Accepts the [discovery webhook contract](discovery-webhook.md). Async by default — returns `202` with `{ runId, statusPath, pollAfterMs }`.

### `GET /runs/:runId?statusToken=...`

Returns the current run record. Bearer credential check via `run-status-auth.ts`. Tokens are per-run; leaking one gives no access to other runs.

### `POST /discovery-profile`

Persists a snapshot of the user's `discoveryProfile` so scheduled runs (cron / Apps Script) have one even when no in-band profile is sent. Body shape: `{ event: "command-center.discovery-profile", schemaVersion: 1, profile: {...} }`.

### `POST /ingest-url`

Single-URL ingest. Body: `{ url, hint?: { company?, title? } }`. The router classifies the URL and runs the full normalize → score → match → exploit pipeline so the resulting row is consistent with bulk runs.

### `POST /cleanup-expired`

Walks the Pipeline, refetches each row's source URL, marks the row expired if the JD is gone. Body is the same envelope shape: `{ event: "command-center.cleanup-expired", schemaVersion: 1, sheetId, googleAccessToken? }`. Only writes to columns the sheet has opted into.

### `OPTIONS *`

CORS preflight handled inline in `server.ts`. Allow-list resolution lives in `http/origin-guard.ts`.

## Method check

Anything other than the documented method returns `405 Method Not Allowed`. This is enforced before secret check so probes don't leak the secret-required signal.

## Webhook secret

`Authorization: Bearer <secret>` is required when `DISCOVERY_WEBHOOK_SECRET` is set. In `local` access policy mode (the default for `npm run discovery:worker:start-local`), the worker treats an unset secret as "no auth required". In `hosted` mode, an unset secret causes the worker to refuse to start.

## Reference

- [HTTP server sub-page](../apps/discovery-worker/http-server.md) for the order invariant
- [Discovery webhook contract](discovery-webhook.md) for payload shapes
- [Security](../security.md) for the token model
