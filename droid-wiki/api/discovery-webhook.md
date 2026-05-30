# Discovery webhook contract

The single shape any user-owned discovery receiver must accept. Authoritative source: `schemas/discovery-webhook-request.v1.schema.json`, with prose in `AGENT_CONTRACT.md` and fixtures in `examples/`.

## Request

`POST <user-configured-url>` with `Content-Type: application/json`. The dashboard sends the optional `Authorization: Bearer <secret>` when the user has configured one.

Body (v1):

```json
{
  "event": "command-center.discovery",
  "schemaVersion": 1,
  "sheetId": "1a2b3c...",
  "variationKey": "9f3e1a",
  "requestedAt": "2026-05-30T01:23:45.678Z",
  "discoveryProfile": {
    "titles": ["Staff frontend engineer"],
    "locations": ["Remote (US)"],
    "compRange": { "minUsd": 220000 },
    "mustHaves": ["TypeScript"],
    "niceToHaves": ["a11y experience"]
  },
  "sourcePreset": "browser_plus_ats",
  "runtime": {
    "maxBudget": { "wallClockMs": 240000 }
  },
  "googleAccessToken": "ya29..."
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `event` | yes | Always `"command-center.discovery"` for v1 |
| `schemaVersion` | yes | `1` today; bump only on breaking change |
| `sheetId` | yes | The Pipeline target |
| `variationKey` | yes | Random hex; receivers use it as a query-variation seed |
| `requestedAt` | yes | ISO-8601 UTC |
| `discoveryProfile` | yes | Title, location, comp, must-haves, etc. See [data models](../reference/data-models.md) |
| `sourcePreset` | no | `browser_only` / `ats_only` / `browser_plus_ats` |
| `runtime` | no | Per-run budget overrides |
| `googleAccessToken` | no | Per-request OAuth token. Worker consumes once, never persists |

## Response shapes

Receivers may answer synchronously or asynchronously:

**Sync (legacy receivers like the Apps Script stub):**

```json
{ "ok": true }
```

**Async (worker default):**

```json
{
  "ok": true,
  "kind": "accepted_async",
  "runId": "01HXYZ...",
  "statusPath": "/runs/01HXYZ?statusToken=...",
  "pollAfterMs": 5000
}
```

The dashboard preserves `statusPath` verbatim. Older receivers may emit `status_path`; the dashboard tolerates both.

**Validation failure:**

```json
{
  "ok": false,
  "validationError": {
    "code": "invalid_schema",
    "message": "...",
    "path": "/discoveryProfile/titles"
  }
}
```

## Run status (worker)

`GET /runs/:runId?statusToken=...`

```json
{
  "runId": "01HXYZ...",
  "status": "in_progress",
  "phase": "scout",
  "counts": { "scouted": 13, "scored": 6, "written": 2 },
  "messages": [{ "level": "info", "text": "scout: greenhouse acme = 4" }],
  "startedAt": "...",
  "updatedAt": "..."
}
```

Status terminal states: `completed`, `completed_with_errors`, `failed`. The dashboard stops polling when status is terminal.

## Stripping `googleAccessToken`

The worker's webhook handler strips this field before any persistence (memory store, run-status store, logs). This is a hard invariant — see [security](../security.md).

## Receivers in the repo

- `integrations/browser-use-discovery/` — the bundled worker
- `integrations/apps-script/` — sync `{ok:true}` stub
- `integrations/openclaw-command-center/SKILL.md` — agent skill
- `templates/github-actions/command-center-discovery.yml` — scheduled poster
- `integrations/n8n/` — HTTP node notes

## Tests

- `tests/discovery-payload-builder.test.mjs`
- `integrations/browser-use-discovery/tests/webhook/handle-discovery-webhook.test.ts`
- `npm run test:contract` — schema vs fixtures vs builder alignment

## Related

- [Discovery feature](../features/discovery.md)
- [Discovery worker](../apps/discovery-worker/index.md)
- [Data models](../reference/data-models.md)
