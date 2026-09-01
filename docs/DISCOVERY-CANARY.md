# Discovery canary

`npm run discovery:canary` is a **read-only** operator command that answers one
question: *is local discovery actually working right now?*

It checks exactly two facts:

1. Is the local browser-use discovery worker up, and is it really **our** worker?
2. How long ago did the newest **successful** discovery run finish?

It performs **no mutation**: one `GET /health` against the local worker and a
read-only listing of the run-state snapshot directory. It never starts a run,
never writes to your Sheet, never refreshes a credential, and never restarts
anything.

## Usage

```bash
npm run discovery:canary                                    # text, 24h freshness threshold
npm run discovery:canary -- --max-age-hours 24 --json       # machine-readable
npm run discovery:canary -- --state-dir ./fixtures/run-state
npm run discovery:canary -- --worker-url http://127.0.0.1:8644
npm run discovery:canary -- --help
```

| Flag | Meaning |
|---|---|
| `--max-age-hours <n>` | How fresh the newest successful run must be. Integer ≥ 1. Default `24`. |
| `--json` | Emit the JSON report instead of the text report. |
| `--state-dir <dir>` | Run-state snapshot directory. Default `~/.jobbored/browser-use-discovery/run-state`. |
| `--worker-url <origin>` | Local worker origin. Default `http://127.0.0.1:8644`. |
| `--help`, `-h` | Print usage and exit `0`. |

## Statuses and exit codes

| Status | Exit | Means |
|---|---|---|
| `healthy` | `0` | The discovery worker answered `/health` as itself, and a successful discovery run finished within the freshness threshold. |
| `stale` | `1` | The worker is fine, but no successful discovery run has landed inside the threshold (or none has ever landed). |
| `unavailable` | `2` | Something the canary needs could not be read: the worker refused the connection or answered unhealthy, or the run-state directory is missing/unreadable. |
| `misconfigured` | `3` | The canary was pointed at the wrong thing: a bad flag, an unusable `--worker-url`, or a port that answers but is **not** the discovery worker. |
| — | `4` | Unhandled internal error (a bug in the canary itself). |

When several apply at once, the worst wins:

```
misconfigured > unavailable > stale > healthy
```

The report always lists **every** reason it found, not just the winning one — a
worker that is down while the run history is fresh prints both facts.

## Reason codes

The output only ever contains reasons from this fixed set:

| Reason | Status it claims |
|---|---|
| `worker_healthy` | healthy |
| `successful_run_fresh` | healthy |
| `no_successful_run` | stale |
| `successful_run_stale` | stale |
| `worker_unreachable` | unavailable |
| `worker_unhealthy` | unavailable |
| `run_state_unreadable` | unavailable |
| `sheets_credential_not_available` | unavailable |
| `worker_not_discovery_service` | misconfigured |
| `worker_url_invalid` | misconfigured |
| `unknown_argument` | misconfigured |
| `invalid_max_age_hours` | misconfigured |

## What counts as a successful discovery run

Read from the run-state snapshot directory:

- `ingest_*` runs are **excluded** — those are single-URL ingests, not discovery
  sweeps, so they say nothing about whether discovery works.
- Success is `status ∈ {completed, partial, empty}`. `empty` counts on purpose:
  the pipeline ran end to end and legitimately found nothing.
- Snapshots that are malformed, truncated, schema-mismatched, or whose `runId`
  disagrees with their filename are skipped, never repaired.

## Google Sheets is never read

The canary deliberately does not touch Sheets. Reading it would require a
Google credential, and a canary that needs a credential is a canary nobody
runs. The report says so explicitly:

```
sheets: unavailable (sheets_credential_not_available)
```

## What the output may contain

Only: the status, reason codes from the table above, the run id, ISO
timestamps, ages in hours, and the **origin** of the health URL.

Never: request or response headers, tokens, your `sheetId`, a run's `error`
string, or any job/source content. This is enforced by a test that feeds a
fake `ya29.` token, a sheet id, a job title, and an error string through both
the health payload and the run history, then asserts none of them appear in
either the text or the JSON output.

## Example

```
$ npm run discovery:canary -- --max-age-hours 24
discovery canary (read-only)
status: healthy
checked at: 2026-09-01T20:34:45.002Z
worker: http://127.0.0.1:8644 reachable=true http=200 discoveryWorker=true
newest successful run: run_a1b2c3 (completed) finished 2026-09-01T19:34:24.465Z, 1.01h ago (threshold 24h)
sheets: unavailable (sheets_credential_not_available)
reason: worker_healthy
reason: successful_run_fresh
exit code: 0
```

## Implementation notes

- Health classification reuses the exported `isBrowserUseDiscoveryHealth` from
  `scripts/bootstrap-local-discovery.mjs`; the health URL comes from
  `buildLocalHealthUrl` in `scripts/discovery-shared-helpers.mjs`. The payload
  contract is pinned in tests against
  `integrations/browser-use-discovery/tests/mocks/health-response.ok.v1.json`.
- Run history is read through `listRunStatusSnapshots(directory)` in
  `integrations/browser-use-discovery/src/state/run-status-store.ts` — an
  additive, pure, read-only export. The canary must **never** call
  `createDiscoveryRunStatusStore`: merely opening that store sweeps `.tmp-`
  leftovers and rewrites corrupt snapshots, which is a mutation.
- `classifyCanary(inputs) → { status, reasons }` is a pure function; `runCanary`
  injects `now`, `fetchImpl`, and `readRunHistory` so every path is testable
  without a network or a real home directory.
