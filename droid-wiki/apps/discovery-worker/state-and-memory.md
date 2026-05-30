# Discovery worker · State and memory

The worker keeps three layers of state: the SQLite memory store (cross-run learning), the run-status store (per-run progress), and the listing-score cache (LLM cost optimization).

## Memory store (SQLite)

`src/state/discovery-memory-store.ts` opens `BROWSER_USE_DISCOVERY_STATE_DB_PATH` (defaults to `~/.jobbored/browser-use-discovery/state/memory.db`). It uses `better-sqlite3` synchronously — every operation is in-process, no network.

Tables (logical, names vary slightly):

| Table | Purpose |
| --- | --- |
| `companies` | Per-company priors: success counts, last-seen surface, last-seen role |
| `surfaces` | Career surface URLs that have produced leads, with success rate |
| `dead_links` | URLs that returned 404 / blocked repeatedly — skipped on subsequent runs |
| `host_suppression` | Hosts with too many low-fit leads — suppressed for N runs |
| `listing_history` | Fingerprints of leads already considered, with verdicts |

`src/state/run-discovery-memory-store.ts` is the run-scoped wrapper around the same DB — it accumulates this run's mutations and commits them in the learn phase so a crashed run doesn't poison memory.

## Listing-score cache

`src/state/listing-score-cache.ts` is a content-addressed cache keyed by `listingFingerprint`. The score and match decision are memoized so re-encountering the same JD (e.g. the same role on Greenhouse and SerpApi) doesn't re-spend LLM budget. The cache lives in the same SQLite database.

## Run-status store

`src/state/run-status-store.ts` is the source of truth for the `/runs/:runId` endpoint. It is dual-layer:

- In-memory `Map<runId, RunStatus>` for fast reads while a run is active.
- Disk persistence under the same state directory, so a worker restart doesn't lose the last 50 runs the dashboard might still be polling.

Each run-status record carries: `status`, `phase`, `counts` (scouted / scored / written), `messages[]`, optional `validationError`, the `discoveryRunsRowIndex`, and the per-run `statusToken`.

The token is a bearer credential tied to one `runId` — even if a token leaks, it gives no access to other runs.

## Discovery profile cache

`src/webhook/handle-discovery-profile.ts` handles `POST /discovery-profile`. The dashboard sends a snapshot of the user's profile (titles, locations, must-haves, comp range) so the worker can use it for scheduled runs that don't come with an in-band profile. The worker persists this snapshot under the state directory and reads it from `loadUserProfile` when no per-request profile is present.

## Expired-job cleanup

`POST /cleanup-expired` (handled by `src/cleanup/expired-job-cleanup.ts`) walks the Pipeline tab, refetches the source URL for stale jobs, and updates the Pipeline row when the role is gone (404, removed, archived). Cleanup writes are scoped to the columns the user explicitly opted into so it cannot clobber notes/status.

## Reset / inspection

State files are all under the configured directory, so `rm -rf ~/.jobbored/browser-use-discovery/state/` resets memory cleanly. `npm run doctor` reports which DB exists, its size, and whether it's readable, without printing row contents.

## Tests

- `tests/state/discovery-memory-store.test.ts`
- `tests/state/listing-score-cache.test.ts`
- `tests/state/run-status-store.test.ts`
- `tests/webhook/handle-discovery-profile.test.ts`
- `tests/cleanup/expired-job-cleanup.test.ts`

## Related

- [HTTP server](http-server.md) — endpoints that read/write this state
- [Run loop](run-loop.md) — when state is mutated
- [Configuration](../../reference/configuration.md) — env vars for state paths
