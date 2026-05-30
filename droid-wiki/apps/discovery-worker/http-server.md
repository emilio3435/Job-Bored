# Discovery worker · HTTP server

`integrations/browser-use-discovery/src/server.ts` is the HTTP entry. It wires runtime config, the Browser Use session manager, grounded-search client, source registry, planners, memory + run-status stores, pipeline writer, DiscoveryRuns logger, and then registers a single-file router.

## Routes

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| `GET` | `/health` | none | inline (`server.ts`) |
| `OPTIONS` | any | none | CORS preflight (`server.ts`) |
| `POST` | `/discovery` | webhook secret | `handle-discovery-webhook.ts` |
| `POST` | `/webhook` | webhook secret | alias for `/discovery` |
| `POST` | `/` | webhook secret | alias for `/discovery` |
| `GET` | `/runs/:runId` | per-run status token | inline (`server.ts`) |
| `POST` | `/discovery-profile` | webhook secret | `handle-discovery-profile.ts` |
| `POST` | `/ingest-url` | webhook secret | `handle-ingest-url.ts` |
| `POST` | `/cleanup-expired` | webhook secret | `handle-cleanup-webhook.ts` |

Aliasing `/`, `/webhook`, `/discovery` is intentional so existing user webhooks don't break when they retarget the worker.

## Method, secret, parse, strip, validate, ack, execute

`handle-discovery-webhook.ts` runs in this order. Every step has tests in `tests/webhook/`:

1. **Method check** — only `POST` is allowed; everything else returns `405`.
2. **Secret auth** — `hasValidWebhookSecret` reads `Authorization: Bearer <secret>` and compares against `DISCOVERY_WEBHOOK_SECRET`. If unset, the worker fails closed in `hosted` mode and open in `local` mode (see `src/config.ts` `resolveAccessPolicy`).
3. **JSON parse** — invalid JSON returns `400`.
4. **Strip `googleAccessToken`** — the per-run token is consumed for this request only. It must never be persisted to memory store, run-status store, logs, or stdout.
5. **Preflight validation** — schema check via the JSON schema validator. Failures return `422` with a structured `validationError`.
6. **First run-status side effect** — the run is registered in the store BEFORE the executor starts, so the async ack returns a `runId` the dashboard can poll immediately.
7. **Execute** — `runDiscovery` is invoked. In async mode the executor returns `202` with `{ ok: true, kind: "accepted_async", runId, statusPath, pollAfterMs }`; in sync mode it blocks until the run is done.

## Run-status endpoint

`GET /runs/:runId?statusToken=...` returns the latest run record. `run-status-auth.ts` checks the `statusToken` bearer credential — it's tied to the specific `runId` so leaking it gives no access to other runs. The response is the JSON shape consumed by `runs-tab.js` and the dashboard's async-discovery polling.

## CORS

`http/origin-guard.ts` resolves allowed origins from `BROWSER_USE_DISCOVERY_ALLOWED_ORIGINS` and the request's `Origin` header. The default in `local` mode is permissive (the user's own browser); in `hosted` mode it requires an explicit allow-list.

## Logging

Every handler funnels through `logEvent` so log shape stays structured (`event`, `runId`, `status`, optional `validationError`, `errorMessage`). Tokens (webhook secret, status token, Google access token) must never appear in log payloads.

## Related

- [Run loop](run-loop.md) — what `runDiscovery` actually does
- [Discovery webhook contract](../../api/discovery-webhook.md) — request/response shapes
- [Security](../../security.md) — token / origin / network model
