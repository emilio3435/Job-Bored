DONE

# BUILD-REPORT-L: Lifecycle and contracts (BEAUDIT w1)

Branch `feat/beaudit-w1-l` (from `feat/beaudit-build-w1b` @ 4a09cf3d), HEAD `2d02ec97`. Nothing is pushed. Every commit ends with `Beaudit-Lane: L` and the attribution lines, and gitleaks found no leaks on any staged set.

Floor at 2d02ec97 (repair round 2) is fully green, VAL-ROUTE-010 included. Earlier caveat, kept for history: one test, VAL-ROUTE-010 in `tests/webhook/routing-enforcement.test.ts`, fails `test:browser-use-discovery`. It fails the same way on the base branch `feat/beaudit-build-w1b`: an export of that branch ran it twice, failed once and passed once. The failure is a 12 s timeout inside `runDiscovery`, which is outside this lane's fence. It was also failing in the baseline run before any lane-L change. Every other floor command is green.

## Commits

- 89c9939a fix(worker): one async run lifecycle that never sticks in running (A2, A12, A21 infra, A3, A4)
- b70d069f fix(worker): boot history rows, bounded run retention, token-safe runs (A5, A17, A9, A15)
- c5bc7798 feat(contract): webhook v1.1 idempotencyKey; schema and parser agree (A7, A20)
- 219b94a8 fix(worker): serialize worker-config upserts so none is lost (A16)
- 5348cb48 feat(worker): testable router, api-error.v1 envelope, run cancel route (A14, E7/A13, A21 route, A18)
- 173f8d3f test(contract): keep the relay changelog row first; pin the 401 envelope (floor fix)
- 4c0122b1 fix(worker): cancel stops the run before it reports cancelled (A21 repair round)
- 2d02ec97 fix(worker): a cancel answer never claims more than happened (A21 repair round 2)

## Claims done

- **A2**: New `src/webhook/run-async-lifecycle.ts` writes the terminal status first and only then disarms the safety timer. A failed write falls back to writing a `failed` status in its own try. If that also fails, the backstop stays armed, and it is unref'd so it cannot hold the process open. `run-status-store.ts` now writes to disk before updating the Map; that is a two-line swap.
- **A12**: Discovery async and ingest async now share `runAsyncLifecycle`. The stale comment is gone. The safety timer now fires at `maxRunDurationMs` plus a grace of 5%, capped at 30 s.
- **A3**: `/ingest-url` proves a Sheets credential before any ATS, Gemini, Browser Use or scrape call, on both the sync and async paths. Without one it answers `409` with the new reason `sheets_credential_missing`.
- **A4**: Both `writeLeadAndRespond` sites now use `return await`.
- **A5**: `webhook/boot-recovery.ts` has `recoverAbandonedRuns`, which writes a DiscoveryRuns row for each abandoned discovery run. Ingest runs are excluded, and a logger failure never blocks boot.
- **A7**: The worker enforces `discovery-webhook-request.v1` after its own field checks. The schema now matches the parser:
  - `sheetId` may be empty or omitted.
  - `variationKey` may be any non-blank string.
  - The tuning objects are closed.
  - List entries must be non-blank, and duplicates are collapsed.
  - Blank intent is the one rule only the parser enforces, and it is documented.
- **A9**: A run authorized only by the request's `googleAccessToken` is capped at 50 minutes (`GOOGLE_ACCESS_TOKEN_SAFE_RUN_MS`). This covers both the run budget and the lifecycle.
- **A13, E7**:
  - Every worker error leaves through `withApiErrorEnvelope` in `webhook/api-error.ts`.
  - The local API wraps `res.json` so every response of 400 or higher carries the envelope.
  - Unknown paths get a JSON 404, the 413 text names no route, and uncaught errors answer JSON 500.
  - The new schema and fixture are `schemas/api-error.v1.schema.json` and `examples/api-error.v1.json`.
- **A14**: `webhook/worker-router.ts` is a side-effect-free listener with a route table and one dispatch helper, and `server.ts` wires into it. `worker-router.test.ts` mounts it on port 0.
- **A15**: Secrets in `mergedUserProfile` are stripped recursively.
- **A16**: Writes through `upsertStoredWorkerConfig` are serialized per path in-process, and each one re-reads the file inside the lock.
- **A17**: `pruneRunStatusSnapshots` runs at boot. It keeps terminal snapshots that are 30 days old or newer and at most the newest 200, and never prunes live runs.
- **A18**:
  - `SourceAdapter.normalize` is dropped.
  - New v1 schemas and examples for `run-status`, `ingest-url-request`, `ingest-url-response`, `cleanup-expired-request` and `cleanup-expired-response`.
  - New `AGENT_CONTRACT.md` sections, rows in `CONTRACT-CHANGELOG.md`, and an update to `examples/README.md`.
- **A20**: Webhook v1.1 adds an optional `idempotencyKey`, and the runId becomes `sha256(sheetId, key)`. The schema, a v1.1 example, the docs and the payload builder's pass-through are updated together.
- **A21**:
  - `POST /runs/:runId/cancel` is secret-authenticated.
  - A cancel aborts the lifecycle's AbortSignal, which is linked into `runDiscovery`'s `abortSignal`, and writes `failed` with "Cancelled by user." plus a history row.
  - Repair round: the cancel now aborts first, waits for `work()` to settle (at most `cancelSettleTimeoutMs`, default 15 s), and writes the cancelled status only after the run stopped. The async discovery path hands `runDiscovery` a pipeline writer wrapped by `guardWriterWithSignal`, which refuses any `write` that starts after the abort. `registry.cancel` is now async and `POST /runs/:id/cancel` awaits it. When the run finishes before it sees the abort, the real `completed` status is written and the route answers `cancelled: false`.
  - It answers 401, 404, 409 `run_already_terminal` and 409 `run_not_cancellable`.
  - Repair round 2 (second-vendor review, three blocking findings):
    - In-flight writes (`run-async-lifecycle.ts:307`): `guardWriterWithSignal` now counts started writes through a `RunWriteTracker` that the lifecycle passes to `work(signal, writes)`. The cancel waits, inside the same settle deadline, for the run and for every started write to settle before it writes the cancelled status. If either is still pending at the deadline, the answer carries `stopConfirmed: false` and the status message says the work may still land.
    - Real-runner attribution (`:292`): `runDiscovery` swallowed ATS abort errors as warnings and finished `partial`. It now calls `throwIfRunCancelled(dependencies.abortSignal)` before the Sheet write and before the DiscoveryRuns row, so a user cancel rejects and the lifecycle records `failed` / `Cancelled by user.` with one history row from the status. `RunCancelledError` moved to `run/run-abort.ts` and is re-exported from the lifecycle. A fulfilled run now really means it passed that last checkpoint.
    - Unsaved cancel (`:320`): when the cancelled status write fails, the registry answers `{ ok: false, reason: "status_not_saved" }` and keeps the run registered. A retry then re-attempts the write, and the safety timer stays armed. `POST /runs/:id/cancel` answers `503` `cancel_status_not_saved` (api-error.v1, `retryable: true`), and a `200` now also carries `stopConfirmed`.
    - `AGENT_CONTRACT.md` cancel paragraph updated; one `CONTRACT-CHANGELOG.md` row appended below the earlier A21 row.

## Claims deferred or partial

- **A14, type-checking tests**: `tsconfig.json` still includes only `src/**`. Adding `tests/**` brings in hundreds of existing untyped test fixtures and is a large change outside one claim. This is left for lane G (split and docs) or a dedicated follow-up.
- **A20, dashboard stamping**: `discovery-payload.js` passes a caller-supplied `idempotencyKey` through, but no click handler stamps one yet. Choosing where one "user action" begins is a frontend decision, owned by the browser lane.
- **E7, F13 (materials drafts expose `WriterJsonError` internals)**: This lives in `server/materials-*`, which is lane M's fence. Those routes now get the envelope fields, but their `error` text is unchanged.
- **E7, D21 (pipeline-patcher route bodies)**: `handle-pipeline-update.ts` belongs to lane S. The router adds the envelope to its bodies without editing the file.
- **A16, cross-process**: A write from the dev-server process racing the worker is not covered by the in-process lock.

## Fence leeway edits

- `integrations/browser-use-discovery/src/server.ts`, startup wiring outside "route table and /runs routes" (A5, A17). Both edits touch worker boot, not a route:
  - Line 278, A17: `pruneRunStatusSnapshots(runtimeConfig.runStateDirectory, { log })` runs once before `createDiscoveryRunStatusStore`. At every boot it deletes terminal run-status snapshots that are older than 30 days or beyond the newest 200. It never deletes a non-terminal snapshot.
  - Line 285, A5: the old inline `runStatusStore.markNonTerminalRunsAbandoned?.(...)` plus its log call is replaced by `recoverAbandonedRuns({...})` from `webhook/boot-recovery.ts`. It terminalizes abandoned runs synchronously before the listener opens, as before. It also writes a DiscoveryRuns history row for each abandoned discovery run, fire-and-forget. A logger failure is logged and never blocks boot.
  - The claims need both: A5's history row and A17's retention bound only take effect if boot calls them. The logic lives in `webhook/boot-recovery.ts`, inside the fence, and `tests/webhook/boot-recovery.test.ts` covers it. `server.ts` gains only the two call sites.

- `discovery-payload.js`: passes `idempotencyKey` through when the caller supplies one. `test:contract` requires the payload builder to mention every schema property, so the A20 schema change needs this.
- `integrations/browser-use-discovery/src/browser/source-adapters.ts`: removes the dead `normalize` implementation (51 lines) and the imports it used. Dropping the type in A18 requires this, because the object literal would otherwise fail excess-property checks.
- `tests/server-hosted-auth-boundary.test.mjs`: three `deepEqual` checks pinned the exact 401 body `{error:"Unauthorized"}`. E7 genuinely changes that body, so they now expect the envelope.
- `tests/api-error-envelope.test.mjs`: a new test file at the repository root.
- `integrations/browser-use-discovery/src/run/run-discovery.ts` (repair round 2, A21): one added import and two `throwIfRunCancelled(dependencies.abortSignal)` lines, one before the Sheet write and one before the DiscoveryRuns row. The change is additive, with no reformatting. PR #107 also edits this file, but these lines are far from its hunks. Needed so a cancel is not recorded as `partial` by the real runner.

Existing tests that changed because the behavior they pin changed, each explained in its commit body:

- `tests/webhook/handle-discovery-webhook.test.ts`: the watchdog test now ticks `computeSafetyDelayMs(15)`.
- `tests/webhook/handle-ingest-url.test.ts`: the shared helper stubs the new credential check as satisfied.
- `tests/webhook/run-async-lifecycle.test.ts` (the earlier A21 test) and `tests/webhook/worker-router.test.ts`: `registry.cancel` is now async and the registered handler returns `{ cancelled, status }`, so these tests await it and return that shape. This is a real behavior change: cancel waits for the run to stop.

## Tests added (red, then green)

Red logs are in `.lane-evidence/logs/red-*.log`.

| Test file | Claims | Red | Green |
|---|---|---|---|
| tests/webhook/run-async-lifecycle.test.ts | A2, A12, A21 | 5 fail / 2 pass (stuck `running`; late failure ignored; no cancel) | 7/7 |
| tests/webhook/run-async-lifecycle.test.ts (repair) | A21 cancel ordering | 1 fail, "cancel resolves only after the run has stopped" (actual false): the old cancel wrote terminal and returned before the run stopped, and the run's later `pipelineWriter.write` went through (`logs/red-a21-cancel-write-race.log`) | 9/9, with the too-late case (`cancelled: false`, real `completed`) (`logs/green-a21-cancel-write-race.log`) |
| tests/webhook/run-cancel-truth.test.ts (repair 2) | A21 truthfulness | 4 fail (`logs/r2-cancel-truth-red.log`): order `write-started -> status:failed -> cancel-response -> write-landed`; `stopConfirmed` undefined; real runner `cancelled` false; unsaved cancel `ok` true | 4/4 (`logs/r2-cancel-truth-green.log`) |
| tests/webhook/worker-router.test.ts (repair 2) | A21 route | 1 fail: 409 instead of 503 for an unsaved cancel | 10/10 |
| tests/state/run-status-store-write-order.test.ts | A2 store | 1 fail ("memory must not run ahead of disk") | 1/1 |
| tests/webhook/ingest-url-order.test.ts | A3, A4 | 4 fail / 1 pass (extraction ran before the credential check; handler threw) | 5/5 |
| tests/webhook/boot-recovery.test.ts | A5, A17 | module missing (no boot history or prune path existed) | 3/3 |
| tests/webhook/request-hardening.test.ts | A9, A15 | 2 fail (maxRunDurationMs 3600000 > 3000000; leaked `sk-nested`) | 3/3 |
| tests/webhook/webhook-schema-parity.test.ts | A7, A20 | 10 fail / 16 pass (8 drift cases; idempotencyKey ignored) | 28/28 |
| tests/webhook/worker-config-write-lock.test.ts | A16 | 2 fail (lost updates) | 2/2 |
| tests/webhook/worker-router.test.ts | A14, E7, A21 | module missing; with the envelope disabled, 8 fail / 1 pass | 9/9 |
| tests/webhook/worker-contract-schemas.test.ts | A18, E7 | ENOENT (the schemas did not exist) | 4/4 |
| tests/api-error-envelope.test.mjs | E7 (API) | 5 fail / 1 pass (bare `{error}`, HTML 404, ATS-named 413) | 6/6 |

A live worker smoke test ran on port 19050 with the lane HOME; output is in `.lane-evidence/logs/live-worker-probe.txt`. It confirmed:

- `/nope` returns a 404 envelope.
- `//` returns 400.
- A cancel without the secret returns 401.
- A cancel of an unknown run returns 404.
- `/ingest-url` with no credential returns 409 `sheets_credential_missing`.
- `schemaVersion: "1"` returns a 400 schema error.

## Floor output

Repair-round-2 run at the tree committed as 2d02ec97. Each command got a fresh `HOME=$(mktemp -d)`, and `PLAYWRIGHT_BROWSERS_PATH` was set. Logs are in `.lane-evidence/logs/floor-r3/`.

```
lint:repo rc=0
typecheck:repo rc=0
test rc=0                           ℹ tests 3741 ℹ pass 3733 ℹ fail 0 ℹ todo 8
test:browser-use-discovery rc=0     ℹ tests 874 ℹ pass 874 ℹ fail 0
test:contract:all rc=0              12 OK lines
test:e2e-smoke rc=0                 24 passed
test:e2e-journey rc=0               33 passed
test:e2e-onboarding rc=0            7 passed
```

In this run, VAL-ROUTE-010 passed. Earlier runs had it timing out intermittently on the base branch too, so it is flaky, not fixed.

## Unverified

- VAL-ROUTE-010 and VAL-ROUTE-016 intermittently time out at 12 s inside `runDiscovery`. The cause was not investigated because it is outside this fence (lane D, `run/*`). The failure reproduces on the base branch export.
- A9 is fixed by the duration cap. Nothing tested a real GIS token expiring at minute 60; the test covers the cap.
- Merge interaction with PR #107 was not tested. That PR edits `run-status-store.ts` and `safety-timer.ts`; this lane's edits to those files are one swapped line pair and one added `unref` line.
- Non-blocking review items were not addressed in this round, because the round was scoped to the three blocking findings: A9 token age, `sourcePreset`/`enabledSources` exclusivity in the schema, and boot-recovery counting `{ok:false}` appends.
- The cancel settle deadline is shared by the run and its in-flight writes (15 s total). A Sheet write slower than that is reported as `stopConfirmed: false`, not waited out.
