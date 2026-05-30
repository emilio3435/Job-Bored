# Discovery worker · Sheets writer

`integrations/browser-use-discovery/src/sheets/pipeline-writer.ts` is the only path through which the worker writes Pipeline rows. It enforces header validation, Link-based dedupe, append vs update semantics, and optional column upgrades for sheets that have opted in.

## Header validation

Before any write, the writer fetches `Pipeline!1:1` and verifies the canonical columns from `schemas/pipeline-row.v1.json` are present in the expected positions. Missing required columns abort the run with a contract violation. Extra columns are tolerated and preserved on update.

## Dedupe

Dedupe is keyed by job URL (`Link` column). The writer:

1. Reads the existing `Link` column once per run.
2. For each lead, checks for an existing row.
3. If found and the row is in a stage like `New`/`Saved` (configurable), updates the existing row.
4. If found and the row is past `Applied`, leaves it alone.
5. If not found, appends a new row.

This means re-running discovery is safe — the worker never duplicates leads, and never clobbers human edits to applied roles.

## Optional column upgrades

`OPTIONAL_PIPELINE_COLUMNS` defines a list of columns that the worker writes when present:

- `Source` (lane id, e.g. `ats_greenhouse`)
- `Source URL` (canonical JD URL)
- `Posted At`
- `Fit Score`
- `Match Reasoning`
- `Pre-Filter Reason`

If a column is absent, the writer skips it silently. Users get a one-click "Upgrade columns" action in the dashboard (Settings → Discovery → Upgrade columns) that adds the missing headers.

## Service account vs user OAuth

`src/sheets/credential-readiness.ts` resolves credentials in this precedence order:

1. Per-request `googleAccessToken` from the webhook body (consumed once, not persisted).
2. `BROWSER_USE_DISCOVERY_GOOGLE_ACCESS_TOKEN` (env override).
3. Service account JSON via `BROWSER_USE_DISCOVERY_SERVICE_ACCOUNT_JSON` or `_FILE`.
4. OAuth tokens via `BROWSER_USE_DISCOVERY_OAUTH_TOKEN_JSON` or `_FILE`.

Service accounts are the recommended path for unattended runs (cron / Apps Script schedule), because they don't expire.

## DiscoveryRuns logger

`src/sheets/discovery-runs-writer.ts` appends one row per run to a `DiscoveryRuns` tab if the user has it. Columns include `RunId`, `StartedAt`, `Status`, `Counts`, `Companies`, `SourcesUsed`, `Errors`. `runs-tab.js` in the dashboard reads this tab to render the History view.

## Blacklist

The writer reads a `Blacklist` tab (if present) before appending. URLs in `Blacklist` are skipped even if they pass the matcher gate. The dashboard's "Hide this" action on a card appends to `Blacklist`.

## Failure modes

- **Sheet not shared with service account** → the writer reports the error and the run completes with `status: "completed_with_errors"` and an empty write set. The dashboard surfaces the error in the run-status drawer.
- **Header mismatch** → contract violation, run aborts; `validationError` is set on the run-status record.
- **Quota / 429** → exponential backoff with jitter; finite retries; final error reported in run record.

## Tests

- `tests/sheets/pipeline-writer.test.ts`
- `tests/sheets/discovery-runs-writer.test.ts`
- `tests/sheets/credential-readiness.test.ts`
- Root-side: `tests/pipeline-contract.test.mjs` enforces schema/README/`app.js` alignment.

## Related

- [Pipeline feature](../../features/pipeline.md)
- [Runs feature](../../features/runs.md)
- [Pipeline schema reference](../../reference/data-models.md)
