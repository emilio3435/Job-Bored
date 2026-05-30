# Expired-job cleanup

Walks the Pipeline, refetches the source URL for stale rows, and marks dead postings without clobbering the user's notes / status.

## Surface

Discovery drawer → Automation → "Cleanup expired" button. Also wired into the scheduled discovery flow as an optional pre-step.

## Modules

| File | Role |
| --- | --- |
| `integrations/browser-use-discovery/src/cleanup/expired-job-cleanup.ts` | Worker module |
| `integrations/browser-use-discovery/src/webhook/handle-cleanup-webhook.ts` | `POST /cleanup-expired` handler |
| `tests/cleanup/expired-job-cleanup.test.ts` | Worker tests |

## Opt-in columns

Cleanup only writes to columns the user has explicitly opted into (e.g., `Status = Expired`, `Closed At`, `Cleanup Note`). If those columns aren't on the sheet, cleanup is a no-op for that row. This prevents the worker from clobbering anything the user might be editing manually.

## Related

- [Discovery worker · HTTP server](../apps/discovery-worker/http-server.md)
- [Discovery worker · Sheets writer](../apps/discovery-worker/sheets-writer.md)
