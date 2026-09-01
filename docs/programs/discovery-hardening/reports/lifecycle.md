# Lane report: lifecycle

Lane C · claim LIFECYCLE-1 · branch `feat/discovery-hardening-lifecycle` · base `d57fdac`
Worktree: `/private/tmp/Job-Bored-discovery-hardening-lifecycle`. Nothing pushed; no PR; no remote touched.
Vehicle check: launched as `claude --model opus --effort high`; running as Opus 5 as required.

## Scope and ownership

**Claim.** accepted -> running -> retryable polling -> terminal success/failure, duplicate delivery, exactly-once Sheet effects.

**What this lane owns and shipped** (matrix rows 14-17 from `SCOUT-worker.md` §LIFECYCLE-1(c)):

| Row | Behavior | Landed as |
|---|---|---|
| 14 | poller accepts `status_path` (snake_case) as well as `statusPath` | `tests/discovery-lifecycle.test.mjs` (5 tests, characterization only, no production edit) |
| 15 | duplicate webhook delivery for the same logical run | `integrations/browser-use-discovery/tests/webhook/lifecycle-idempotency.test.ts` + LD-3 guard in `handle-discovery-webhook.ts` |
| 16 | exactly-once DiscoveryRuns row across deliveries | same |
| 17 | exactly-once Pipeline write across deliveries | same |

**Rows 1-12 already had proving tests — cited, not duplicated:**

| # | State | Existing proving test |
|---|---|---|
| 1 | `accepted` built + persisted first | `tests/state/run-status-store.test.ts:80`; ack shape `tests/webhook/handle-discovery-webhook.test.ts:618` |
| 2 | `running` persisted before dispatch; 500 if persist fails | `tests/webhook/handle-discovery-webhook.test.ts:4099` (F1B-RUN02-PERSIST) |
| 3 | terminal `completed` (sync) | `handle-discovery-webhook.test.ts:415` |
| 4 | terminal `completed` (async) | `handle-discovery-webhook.test.ts:618` |
| 5 | terminal `failed` (async) | `handle-discovery-webhook.test.ts:726` |
| 6 | terminal immutable vs late write | `handle-discovery-webhook.test.ts:3992` (F1B-RUN01-IMMUT) + `tests/state/run-status-store.test.ts:408` |
| 7 | watchdog terminalization + one history row | `handle-discovery-webhook.test.ts:4219` (F1B-RUN05-FINAL) |
| 8 | catastrophic async failure -> one durable history row | `handle-discovery-webhook.test.ts:4167` |
| 9 | finalizer idempotent per runId | `tests/webhook/run-discovery-runs-log.test.ts:282` |
| 10 | worker restart terminalizes in-flight runs | `tests/state/run-status-store.test.ts:129` |
| 11 | poller: stale generation / stale runId cannot land | `tests/discovery-run-status-polling.test.mjs:280`, `:297` |
| 12 | poller: synthesizes `/runs/:id` only for local workers; hosted `statusPath` verbatim | `tests/discovery-run-status-polling.test.mjs:130`, `:149` |

**Explicitly NOT this lane (per LD-4):** row 13, poll retry classification (404/401 must be terminal, not retryable) belongs to Lane D's unit (ii) in `discovery-status-handoff.js` / `discovery-run-tracker.js`. I did not implement it and wrote no test that depends on it. The two RED cases in the scout's poll probe stay red on this branch by design.

**Fence compliance.** Files touched, all inside the Lane C fence:

- production: `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts`
- tests: `integrations/browser-use-discovery/tests/webhook/handle-discovery-webhook.test.ts` (2 pinning lines), `integrations/browser-use-discovery/tests/webhook/lifecycle-idempotency.test.ts` (new), `tests/discovery-lifecycle.test.mjs` (new)

Not touched: `src/server.ts` (in the fence, but no wiring turned out to be needed — see Implementation), `src/state/run-status-store.ts` (Lane E), `discovery-status-handoff.js` / `discovery-run-tracker.js` (Lane D), any schema/contract file, `package.json`, `index.html`, `config.js`.

## Baseline and RED evidence

Both probes run from this worktree at base `d57fdac`, before any implementation.

### RED 1 — duplicate delivery (rows 15/16/17). Exit 1.

```
$ node --experimental-strip-types --test .lane-evidence/scout-worker/lifecycle-duplicate-delivery.probe.test.ts
[probe] observed: firstRunId=run_1 secondRunId=run_2 runDiscoveryCalls=2 discoveryRunsAppends=2
✖ LIFECYCLE-1: a duplicate webhook delivery must not start a second run (2.330958ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 95.655792

✖ failing tests:

test at .lane-evidence/scout-worker/lifecycle-duplicate-delivery.probe.test.ts:54:1
✖ LIFECYCLE-1: a duplicate webhook delivery must not start a second run (2.330958ms)
  AssertionError [ERR_ASSERTION]: duplicate delivery must resolve to the SAME runId (got run_1 then run_2)
  
  'run_2' !== 'run_1'
  
      at TestContext.<anonymous> (file:///private/tmp/Job-Bored-discovery-hardening-lifecycle/.lane-evidence/scout-worker/lifecycle-duplicate-delivery.probe.test.ts:160:10)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 'run_2',
    expected: 'run_1',
    operator: 'strictEqual',
    diff: 'simple'
  }
```

Load-bearing line: `runDiscoveryCalls=2 discoveryRunsAppends=2` — two byte-identical POSTs started two runs and wrote two DiscoveryRuns rows.

### RED 2 — poll classification + statusPath contract (row 14 mine, row 13 Lane D's). Exit 1.

```
$ node --test .lane-evidence/scout-worker/lifecycle-poll-classification.probe.test.mjs
[probe] 404 produced pollErrors=["Status endpoint returned HTTP 404"]
[probe] 401 produced pollErrors=["Status endpoint returned HTTP 401"]
▶ LIFECYCLE-1 probe — poll response classification
  ✔ LIFECYCLE-1: a 503 from /runs/:id is retryable and marks a poll error (1.804834ms)
  ✖ LIFECYCLE-1: a 404 from /runs/:id is terminal and must not burn a retry (1.495292ms)
  ✖ LIFECYCLE-1: a 401 from /runs/:id is terminal and must not burn a retry (0.68575ms)
✖ LIFECYCLE-1 probe — poll response classification (4.700833ms)
▶ LIFECYCLE-1 probe — statusPath / status_path contract
  ✔ LIFECYCLE-1: accepts camelCase statusPath from an accepted_async ack (0.972833ms)
  ✔ LIFECYCLE-1: accepts snake_case status_path from an accepted_async ack (0.43675ms)
✔ LIFECYCLE-1 probe — statusPath / status_path contract (1.493333ms)
ℹ tests 5
ℹ suites 2
ℹ pass 3
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 55.594292

✖ failing tests:

test at .lane-evidence/scout-worker/lifecycle-poll-classification.probe.test.mjs:78:3
✖ LIFECYCLE-1: a 404 from /runs/:id is terminal and must not burn a retry (1.495292ms)
  AssertionError [ERR_ASSERTION]: 404 (run not found) is not retryable — retrying it 3x and then claiming 'the run may still be running' is a false statement
  + actual - expected
  
  + [
  +   'Status endpoint returned HTTP 404'
  + ]
  - []
  
      at TestContext.<anonymous> (file:///private/tmp/Job-Bored-discovery-hardening-lifecycle/.lane-evidence/scout-worker/lifecycle-poll-classification.probe.test.mjs:91:12)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Suite.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: [ 'Status endpoint returned HTTP 404' ],
    expected: [],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at .lane-evidence/scout-worker/lifecycle-poll-classification.probe.test.mjs:98:3
✖ LIFECYCLE-1: a 401 from /runs/:id is terminal and must not burn a retry (0.68575ms)
  AssertionError [ERR_ASSERTION]: 401 (bad/absent status token) is not retryable
  + actual - expected
  
  + [
  +   'Status endpoint returned HTTP 401'
  + ]
  - []
  
      at TestContext.<anonymous> (file:///private/tmp/Job-Bored-discovery-hardening-lifecycle/.lane-evidence/scout-worker/lifecycle-poll-classification.probe.test.mjs:111:12)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Suite.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: [ 'Status endpoint returned HTTP 401' ],
    expected: [],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

The two `statusPath` / `status_path` cases are GREEN here — that is the point. The behavior at `discovery-status-handoff.js:542` is real but had **zero** tests in the repo (`grep -rn "status_path" tests/` -> 0 hits), so a refactor could have deleted the snake_case branch with nothing going red. Row 14 is a characterization gap, not a defect. The two failing cases (404/401) are row 13, Lane D's.

## Implementation

### 1. Deterministic run identity (LD-3), `handle-discovery-webhook.ts`

New exported pure function, placed beside `createRunId`:

```ts
export function deriveIdempotentRunId(request: {
  sheetId?: string;
  variationKey?: string;
  requestedAt?: string;
}): string | null
```

`run_<sha256(sheetId \n variationKey \n requestedAt)[:32]>`, or `null` when `requestedAt` is absent/unparseable. No clock, no randomness, no I/O — routing and identity are decided by code, never by a model.

Two call sites:

- **Minting (`:146`)** — `dependencies.runDependencies.runId || derivedRunId || createRunId(randomId)`. Derived only when `dependencies.runStatusStore` exists (there is otherwise nothing to look a duplicate up in) and `requestedAt` parses, exactly as LD-3(b) requires; otherwise today's random runId, so a missing `requestedAt` can never collapse every future run onto one id.
- **Short circuit (after preflight, immediately before `buildAcceptedRunStatus` + the first `runStatusStore.put`)** — `runStatusStore.get(derivedRunId)`; if a status exists, return the ORIGINAL runId and statusPath and stop. Non-terminal -> `202 accepted_async` with the live run's current message and `pollAfterMs`; terminal -> `200 completed_sync` with `outcome` = the stored terminal status. `runDiscovery` is not called, no second `createTerminalHistoryFinalizer` is created, no second Pipeline write happens.

Order invariant preserved exactly: method -> secret auth -> JSON parse -> per-run `googleAccessToken` strip -> preflight -> **[new short circuit]** -> first run-status side effect -> run. The new branch replaces the first side effect on a duplicate; it never precedes auth, parse or preflight.

`statusPath` is recomputed from the same derived runId, so the duplicate's ack is byte-identical to the original's — including the hosted-mode `statusToken` query string, since `createRunStatusToken` is keyed on the runId.

One new log event, `discovery.request.duplicate_delivery_ignored`, carrying only runId/mode/sheetId/variationKey/existingStatus — the same fields the adjacent `discovery.request.validated` event already logs.

### 2. `src/server.ts` — no change needed

The fence allows editing `sharedRunDependencies` (~292-308) "solely to wire the behavior on". No wiring is required: `sharedRunDependencies` already omits `runId` (it only sets `randomId`), and the call site at `server.ts:1568-1584` already passes `runStatusStore`. The guard therefore turns on in production as-is. I left the file untouched rather than make a no-op edit.

### 3. Tests

**`integrations/browser-use-discovery/tests/webhook/lifecycle-idempotency.test.ts`** (new, 17 tests, in the `tests/webhook/*.test.ts` glob so it actually runs):

- rows 15/16/17: same runId + same statusPath, `runDiscovery` once, one DiscoveryRuns append, one Pipeline write
- duplicate arriving while the original is genuinely **in flight** -> 202 with the live run's message. The race is controlled by a `deferred()` gate plus a `runStarted` promise the run resolves itself — **no `setTimeout`, no sleep**
- duplicate of a finished run -> its terminal `outcome`, not a new run
- the guard does not swallow real work: a different `requestedAt`, `variationKey`, or `sheetId` each start a fresh run
- no run-status store -> runIds stay random (`run_1`, `run_2`), behavior unchanged
- order invariant: a redelivery with a bad secret is still 401 with `auth.category = secret_mismatch` and leaks no runId; an unparseable redelivery is still 400
- a duplicate ack never echoes the per-request `googleAccessToken`
- derivation purity: deterministic, `run_[0-9a-f]{32}` shape, all four identity permutations distinct, separator-safe (`"ab"+"c"` != `"a"+"bc"`), `null` for missing/blank/invalid `requestedAt`

**`tests/discovery-lifecycle.test.mjs`** (new, 5 tests, row 14, characterization only): mounts `discovery-status-handoff.js` with the vm harness from `tests/run-status-honesty.test.mjs:67-117` and pins that `resolveAcceptedRunStatusPath` accepts both spellings, that a snake_case ack from a **hosted** worker is polled rather than dropped (with the no-path control that shows synthesis cannot cover for it), that camelCase wins when both are present, and that a blank `status_path` falls through to synthesis instead of polling an empty path.

**`handle-discovery-webhook.test.ts`** — minimal adjustment, 2 added `runId: "run_queued"` lines (+ comments). That suite's 73 tests are about status transitions, ack shape, logging and the watchdog, not about how the id is minted, so they now pin the id through the handler's existing highest-precedence `runId` dependency instead of through `randomId`. Every assertion below is unchanged, byte for byte. The second line is needed because that one test replaces `runDependencies` wholesale (`makeDependencies` spreads `...overrides` last, which clobbers its own merged `runDependencies` — a pre-existing quirk of the helper, left alone).

### Finding requested by the kickoff

`requestedAt` is **not** validated by preflight. It is validated in `parseWebhookRequest` (`handle-discovery-webhook.ts:660`), i.e. at step 3 of the order invariant, returning a 400 `"requestedAt must be a valid ISO timestamp."` — that is what the test at `handle-discovery-webhook.test.ts:2407` pins. Consequence for LD-3: by the time the idempotency guard runs, `requestedAt` is always a parseable timestamp, so the `null` branch of `deriveIdempotentRunId` is unreachable through the HTTP path and only matters for direct callers. The guard keeps it anyway, and `lifecycle-idempotency.test.ts` pins both the 400 and the `null` branch.

## Verification and raw output

### RED -> GREEN, duplicate delivery probe (unmodified scout probe). Exit 0.

```
$ node --experimental-strip-types --test .lane-evidence/scout-worker/lifecycle-duplicate-delivery.probe.test.ts
[probe] observed: firstRunId=run_6789500902d1d2b90eba91edda26ec72 secondRunId=run_6789500902d1d2b90eba91edda26ec72 runDiscoveryCalls=1 discoveryRunsAppends=1
✔ LIFECYCLE-1: a duplicate webhook delivery must not start a second run (4.998208ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 131.489416
```

`firstRunId == secondRunId`, `runDiscoveryCalls=1`, `discoveryRunsAppends=1` — was `run_1` / `run_2` / `2` / `2`.

### New worker suite (rows 15/16/17 + purity + order invariant). Exit 0.

```
$ node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/lifecycle-idempotency.test.ts
✔ LIFECYCLE-1: a duplicate delivery resolves to the original runId and starts no second run (4.335458ms)
✔ LIFECYCLE-1: a duplicate delivery writes exactly one DiscoveryRuns row (0.51225ms)
✔ LIFECYCLE-1: a duplicate delivery performs exactly one Pipeline write (0.25075ms)
✔ LIFECYCLE-1: a duplicate arriving while the original run is still in flight returns the live run (0.575666ms)
✔ LIFECYCLE-1: a duplicate of a finished run returns its terminal outcome, not a new run (0.584709ms)
✔ LIFECYCLE-1: a different requestedAt starts a fresh run (0.545708ms)
✔ LIFECYCLE-1: a different variationKey starts a fresh run (0.380042ms)
✔ LIFECYCLE-1: a different sheetId starts a fresh run (0.412291ms)
✔ LIFECYCLE-1: without a run-status store the runId stays random, so nothing collapses (0.24275ms)
✔ LIFECYCLE-1: a redelivery with a bad secret is still rejected 401 before any dedupe (0.359417ms)
✔ LIFECYCLE-1: an unparseable redelivery is still rejected 400 before any dedupe (0.145416ms)
✔ LIFECYCLE-1: an invalid requestedAt is rejected at parse, so it can never collapse runs (0.1085ms)
✔ LIFECYCLE-1: a duplicate ack never echoes the per-request googleAccessToken (0.15125ms)
✔ LIFECYCLE-1: deriveIdempotentRunId is deterministic for one request identity (0.081833ms)
✔ LIFECYCLE-1: deriveIdempotentRunId separates every identity field (0.066375ms)
✔ LIFECYCLE-1: deriveIdempotentRunId cannot be forged by moving a field boundary (0.028917ms)
✔ LIFECYCLE-1: deriveIdempotentRunId returns null without a usable requestedAt (0.032167ms)
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 120.490209
```

### New root suite (row 14). Exit 0.

```
$ npm test -- tests/discovery-lifecycle.test.mjs
> command-center@0.1.0 test
> node scripts/run-tests.mjs tests/discovery-lifecycle.test.mjs

▶ LIFECYCLE-1 — accepted ack statusPath contract
  ✔ LIFECYCLE-1: accepts camelCase statusPath from an accepted_async ack (1.261334ms)
  ✔ LIFECYCLE-1: accepts snake_case status_path from an accepted_async ack (0.294875ms)
  ✔ LIFECYCLE-1: a snake_case ack from a hosted worker is polled rather than dropped (0.395959ms)
  ✔ LIFECYCLE-1: camelCase wins when an ack carries both spellings (0.369792ms)
  ✔ LIFECYCLE-1: a blank status_path falls through to synthesis instead of polling an empty path (0.338625ms)
✔ LIFECYCLE-1 — accepted ack statusPath contract (3.17ms)
ℹ tests 5
ℹ suites 1
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 57.109959
```

### Targeted gate — `npm run test:browser-use-discovery`. Exit 0.

```
$ npm run test:browser-use-discovery
ℹ tests 744
ℹ suites 2
ℹ pass 744
ℹ fail 0
ℹ skipped 0
ℹ todo 0
exit=0
```

Zero `✖` lines in the full output.

### Targeted gate — `npm run typecheck:browser-use-discovery`. Exit 0.

```
$ npm run typecheck:browser-use-discovery

> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

exit=0
```

### Contract gate (LD-3 requires it green with no contract edits). Exit 0.

```
$ npm run test:contract:all
OK schema: examples/discovery-webhook-request.v1.json
OK schema: examples/discovery-webhook-request.v1-with-profile.json
OK schema: examples/discovery-webhook-request.v1-preview-parity.json
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
OK discovery-readiness.js delegates to discovery-payload.js
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md
exit=0
```

No schema or contract file was edited.

### Repository floor

```
$ npm run typecheck:repo
exit=0

$ npm run lint:repo

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
exit=0

$ npm run test:repo
ℹ tests 2489
ℹ suites 589
ℹ pass 2488
ℹ fail 0
ℹ skipped 0
ℹ todo 1
ℹ tests 744
ℹ suites 2
ℹ pass 744
ℹ fail 0
ℹ skipped 0
ℹ todo 0
exit=0

$ git diff --check
exit=0
```

`test:repo` reports two blocks: the root `tests/*.test.mjs` run (2489 tests, 0 fail, 1 pre-existing `todo` — "persists and can remove the canonical submission evidence record", blocked on the canonical-ownership gate, untouched by this lane) and the worker run (744 tests, 0 fail).

### Belt and braces — full `npm test` (includes `tests/integration/`, which `node --test tests/*.test.mjs` silently skips). Exit 0.

```
$ npm test
ℹ tests 2520
ℹ suites 598
ℹ pass 2519
ℹ fail 0
ℹ skipped 0
ℹ todo 1
exit=0
```

## Commit, risks, and handoff

**Commit (local only, never pushed):**

```
88e156ba12897ad7468c105cff2fd450b2d57c20
fix(discovery-hardening/lifecycle): make duplicate webhook delivery exactly-once
4 files changed, 748 insertions(+)
```

**Diff reviewed and secret-scanned.** `grep -nE 'ya29\.|AIza|sk-[A-Za-z0-9]|ngrok|\.ts\.net|trycloudflare|docs\.google\.com/spreadsheets|[A-Za-z0-9_-]{40,}'` over all four files: the only hits are `// ---` comment rules in the new test file and two pre-existing fake-secret literals at `handle-discovery-webhook.test.ts:3933,3963` that this diff does not touch. No real hostnames, no Sheet IDs, no `.env` values, no `config.js` read anywhere.

### Risks and things Emilio should look at

1. **RunId shape changed from `run_<uuid>` to `run_<sha256[:32]>`.** Scout-verified that nothing parses runId structure (`buildRunStatusPath` just `encodeURIComponent`s it; the snapshot filename is base64url of the whole string), and the ack schema is unchanged. But run-state snapshot files written by an older worker keep their old ids, so after this ships a redelivery of a run started *before* the upgrade will not dedupe. That is a one-time transitional gap, not a defect.
2. **The dedupe key includes `sheetId`, which preflight allows to be empty in local mode** (it falls back to the stored worker config, `handle-discovery-webhook.ts:610`). Two local runs that both omit `sheetId` therefore share the empty component — but `variationKey` and `requestedAt` still separate them, and `requestedAt` is stamped fresh per click at `discovery-payload.js:293`. Pinned by the "different requestedAt / variationKey" tests.
3. **A duplicate of a run that FAILED returns `200` with `kind: "completed_sync"` and `outcome.status = "failed"`.** The ack `kind` union is only `accepted_async | completed_sync` and LD-3 forbids a contract edit, so "this run is finished, here is the outcome" is expressed with `completed_sync` + `outcome`. Browser-side this is safe — only `accepted_async` is special-cased (`discovery-engine-state.js:286`, `discovery-run-orchestration.js:390`) — but it reads oddly in a log. Flagging as a naming wart, not a behavior bug. If a future contract bump is on the table, a `kind: "duplicate"` would be cleaner.
4. **The existing 73-test webhook suite now pins its runId through the `runDependencies.runId` seam**, a configuration production does not use (production leaves it unset). That was the 2-line adjustment instead of rewriting 29 `run_queued` assertions. The derived path is driven end to end — sync and async, store writes, appends, pipeline writes — by the new 17-test suite, so nothing is left uncovered; but a reviewer should know the old suite no longer exercises derivation.

### Handoff

- **Lane D (per LD-4):** row 13 is still open on this branch by design. `.lane-evidence/scout-worker/lifecycle-poll-classification.probe.test.mjs` stays RED on the 404 and 401 cases. Lane D owns `classifyRunStatusPollResponse` in `discovery-status-handoff.js` plus the terminal-marking entry point in `discovery-run-tracker.js`, with `LIFECYCLE-1:`-prefixed tests. My `tests/discovery-lifecycle.test.mjs` mounts the same file but only calls `resolveAcceptedRunStatusPath`, so it should not collide with Lane D's edits to `pollRunStatus` / `startDiscoveryStatusPolling`.
- **Lane E (per LD-6):** I did not touch `src/state/run-status-store.ts`. My guard uses only the existing `get()`, so `listRunStatusSnapshots` lands cleanly on top. Note for E: after this change, run-state snapshot filenames encode a derived id, which does not affect a readdir-based lister.
- **Integrator:** no cross-lane change is needed and no contract edit was required. `src/server.ts` was deliberately left untouched even though it is in the fence.
- **Nothing blocked.** No environmental failures; every gate ran clean in this worktree.
