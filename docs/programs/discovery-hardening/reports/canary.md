# Lane report: canary

## Scope and ownership

Lane E · canary, claim **CANARY-1**: *One read-only command classifies worker health and recent discovery
success without exposing secrets.*

Branch `feat/discovery-hardening-canary`, worktree `/private/tmp/Job-Bored-discovery-hardening-canary`,
cut from the locked spec commit `d57fdac`.

Fence (exclusive, per KICKOFF-canary.md + spec LD-8):

| Path | Kind |
|---|---|
| `scripts/discovery-canary.mjs` | new production CLI |
| `tests/discovery-canary.test.mjs` | new test |
| `package.json` | exactly two edits (script line + `typecheck:repo` entry) |
| `docs/DISCOVERY-CANARY.md` | new doc |
| `integrations/browser-use-discovery/src/state/run-status-store.ts` | ONE additive export (LD-6) |
| `integrations/browser-use-discovery/tests/state/run-status-store.test.ts` | additive cases |

Consumed read-only (not edited): `scripts/bootstrap-local-discovery.mjs` (`isBrowserUseDiscoveryHealth`),
`scripts/discovery-shared-helpers.mjs` (`buildLocalHealthUrl`, `DEFAULT_LOCAL_PORT`),
`scripts/discovery-keep-alive.mjs` (parseArgs shape), `scripts/doctor.mjs` (check/summarize/DI/main-guard shape),
`integrations/browser-use-discovery/tests/mocks/health-response.ok.v1.json` (payload contract pin).

## Baseline and RED evidence

Both kickoff RED probes run on the lane branch BEFORE any implementation.

### RED probe 1 — `npm run discovery:canary -- --max-age-hours 24 --json`

```
npm error Missing script: "discovery:canary"
npm error
npm error To see a list of scripts, run:
npm error   npm run
npm error A complete log of this run can be found in: /Users/emilionunezgarcia/.npm/_logs/2026-09-01T20_28_01_354Z-debug-0.log
EXIT=1
```

### RED probe 2 — `node --experimental-strip-types --test .lane-evidence/scout-worker/canary-run-history-reader.probe.test.ts`

```
(node:71278) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///private/tmp/Job-Bored-discovery-hardening-canary/.lane-evidence/scout-worker/canary-run-history-reader.probe.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /private/tmp/Job-Bored-discovery-hardening-canary/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
[probe] run-status-store exports: buildAcceptedRunStatus, buildCompletedRunStatus, buildFailedRunStatus, buildRunStatusPath, buildRunningRunStatus, createDiscoveryRunStatusStore
[probe] files before=["cnVuX29ycGhhbg.json.tmp-1-2-3"] after=[]
✖ CANARY-1: run-status-store exposes a read-only snapshot listing the canary can reuse (1.028375ms)
✖ CANARY-1: createDiscoveryRunStatusStore is NOT usable as a read-only reader (2.05575ms)
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 141.138459

✖ failing tests:

test at .lane-evidence/scout-worker/canary-run-history-reader.probe.test.ts:11:1
✖ CANARY-1: run-status-store exposes a read-only snapshot listing the canary can reuse (1.028375ms)
  AssertionError [ERR_ASSERTION]: no exported read-only listing (list/read/loadRunStatus*) — the canary has nothing to import for 'newest successful run'
      at TestContext.<anonymous> (file:///private/tmp/Job-Bored-discovery-hardening-canary/.lane-evidence/scout-worker/canary-run-history-reader.probe.test.ts:17:10)
      at Test.runInAsyncScope (node:async_hooks:214:14)
      at Test.run (node:internal/test_runner/test:1106:25)
      at Test.start (node:internal/test_runner/test:1003:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:358:17)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at .lane-evidence/scout-worker/canary-run-history-reader.probe.test.ts:23:1
✖ CANARY-1: createDiscoveryRunStatusStore is NOT usable as a read-only reader (2.05575ms)
  AssertionError [ERR_ASSERTION]: opening the store mutated the run-state directory — a read-only canary cannot use createDiscoveryRunStatusStore
  + actual - expected
  
  + []
  - [
  -   'cnVuX29ycGhhbg.json.tmp-1-2-3'
  - ]
  
      at TestContext.<anonymous> (file:///private/tmp/Job-Bored-discovery-hardening-canary/.lane-evidence/scout-worker/canary-run-history-reader.probe.test.ts:37:12)
      at Test.runInAsyncScope (node:async_hooks:214:14)
      at Test.run (node:internal/test_runner/test:1106:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:788:18)
      at Test.postRun (node:internal/test_runner/test:1235:19)
      at Test.run (node:internal/test_runner/test:1163:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: [],
    expected: [ 'cnVuX29ycGhhbg.json.tmp-1-2-3' ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
EXIT=1
```

Both confirm the claim's two gaps: (a) no `discovery:canary` entry point at all, and (b) no read-only
listing export on `run-status-store.ts` — the only existing opener, `createDiscoveryRunStatusStore`,
mutated the directory (deleted the stray `.tmp-` file: `before=["cnVuX29ycGhhbg.json.tmp-1-2-3"] after=[]`).

## Implementation

Three pieces, no more.

### 1. `listRunStatusSnapshots(directory)` — the missing read-only reader (spec LD-6)

One additive pure export on
`integrations/browser-use-discovery/src/state/run-status-store.ts` (+ the
now-exported `RunStatusSnapshotV1` type it returns). It readdirs, filters on the
`.json` suffix, decodes the runId out of the base64url filename with the file's
own existing decoder, `JSON.parse`s, validates with the file's own
`isRunStatusSnapshot` guard, and checks the runId against the filename. Anything
that fails is **skipped** — never repaired.

It never `mkdir`s, never `unlink`s, never writes. That is the whole point: the
scout probe proved that merely calling `createDiscoveryRunStatusStore` sweeps
`.tmp-` leftovers and rewrites corrupt snapshots, so per LD-6 the canary never
calls it. No existing store behavior changed; `createDiscoveryRunStatusStore`
still sweeps and repairs, because for the *writer* that is correct.

### 2. `scripts/discovery-canary.mjs` — the classifier and CLI

- `classifyCanary(input) → { status, reasons }` — pure. Takes already-reduced,
  already-redacted facts; emits reasons only from a frozen enum, each of which
  declares the status it claims. The status is the worst claimed status
  (`misconfigured > unavailable > stale > healthy`). It reports **every** reason
  it found, not just the winning one, so a down worker with a fresh run history
  prints both facts instead of hiding one.
- `runCanary(options)` — copies `doctor.mjs`'s DI shape (`now`, `fetchImpl`,
  `readRunHistory` defaulted at the top). Health: `buildLocalHealthUrl` for the
  URL, a local `probeWorkerHealth` that rebuilds the exact probe shape
  `bootstrap-local-discovery.mjs::probeHealth` builds but around the injected
  fetch (`probeHealth` is not exported and uses global fetch), then the already
  exported `isBrowserUseDiscoveryHealth` to classify it. Run history: the
  default reader wraps `listRunStatusSnapshots`; `runCanary` applies the policy
  (drop `ingest_` runs, keep `completed|partial|empty`, newest wins, unparseable
  timestamps skipped).
- `formatCanaryReport(report)` — the text renderer, copied from
  `formatDoctorReport`'s line shape.
- `parseArgs(argv)` — the valued-flag loop shape from
  `discovery-keep-alive.mjs:487`; throws with a `canaryReason` carrying the
  fixed-enum code, which the main guard turns into a misconfigured report and
  exit 3. `--help` prints usage and exits 0.
- `import.meta.url` main guard, as in `doctor.mjs`.

Google Sheets is never read — the report states this as a first-class finding
(`sheets: unavailable (sheets_credential_not_available)`) rather than silently
omitting it.

`node scripts/discovery-canary.mjs` imports the worker `.ts` directly and runs
with **no flags** on Node 24 (default type stripping) — verified before writing
the script.

### 3. `package.json` (exactly two edits) and `docs/DISCOVERY-CANARY.md`

- `"discovery:canary": "node scripts/discovery-canary.mjs",` immediately after
  `discovery:keep-alive` (line 35).
- `&& node --check scripts/discovery-canary.mjs` immediately after the existing
  `node --check scripts/discovery-keep-alive.mjs` in `typecheck:repo` — the trap
  #2 guard.
- The doc covers usage, every flag, the status/exit-code table, the precedence
  rule, the full reason enum, what counts as a successful discovery run, why
  Sheets is never read, and what the output may and may not contain.

### Deviation from the kickoff, flagged

The kickoff names `export { classifyCanary, formatCanaryReport, runCanary }`.
The exported set is those three **plus `CANARY_EXIT_CODES` and `parseArgs`** —
both are required by tests the same kickoff demands ("covers all four statuses +
the exit codes", "unknown flag → misconfigured exit 3"), and neither is
reachable through the three named exports. Additive only; nothing was renamed.

## Verification and raw output

### 1. RED → GREEN, claim probe

RED for both probes is pasted in **Baseline and RED evidence** above.

**Probe 1 GREEN** — the command now exists and classifies (full six-case CLI
transcript in section 3 below); the RED `npm error Missing script:
"discovery:canary"` / exit 1 is gone, replaced by real statuses and exit codes.

**Probe 2, re-run verbatim after implementation** (`node --experimental-strip-types --test .lane-evidence/scout-worker/canary-run-history-reader.probe.test.ts`):

```
[probe] run-status-store exports: buildAcceptedRunStatus, buildCompletedRunStatus, buildFailedRunStatus, buildRunStatusPath, buildRunningRunStatus, createDiscoveryRunStatusStore, listRunStatusSnapshots
[probe] files before=["cnVuX29ycGhhbg.json.tmp-1-2-3"] after=[]
✔ CANARY-1: run-status-store exposes a read-only snapshot listing the canary can reuse (0.505333ms)
✖ CANARY-1: createDiscoveryRunStatusStore is NOT usable as a read-only reader (1.494708ms)
ℹ tests 2
ℹ suites 0
ℹ pass 1
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 78.216458
```

Read this honestly: the scout probe's **first** test — "run-status-store exposes
a read-only snapshot listing the canary can reuse" — flipped RED → **GREEN**
(`listRunStatusSnapshots` now appears in the export list). That is the assertion
this lane owns.

The probe's **second** test stays RED **by design**. It asserts that
`createDiscoveryRunStatusStore` does not mutate the directory — but sweeping
`.tmp-` leftovers is *correct* behavior for the writable store, and LD-6's
instruction is "NEVER call `createDiscoveryRunStatusStore` from the canary", i.e.
avoid it, not change it. Changing the writer's sweep is out of this lane's fence
and would be a real regression. The equivalent guarantee is proven instead by
this lane's own tests, on the path the canary actually takes — see below.

### 2. Targeted gate — `npm test -- tests/discovery-canary.test.mjs`

```
> command-center@0.1.0 test
> node scripts/run-tests.mjs tests/discovery-canary.test.mjs
✔ CANARY-1: classifyCanary reports healthy (exit 0) when the worker is the discovery worker and a recent successful run exists (0.737125ms)
✔ CANARY-1: classifyCanary reports stale (exit 1) when no successful discovery run has ever landed (0.087375ms)
✔ CANARY-1: classifyCanary reports stale (exit 1) when the newest successful run is older than --max-age-hours (0.068541ms)
✔ CANARY-1: classifyCanary reports unavailable (exit 2) when the worker is unreachable (0.051084ms)
✔ CANARY-1: classifyCanary reports unavailable (exit 2) when the worker answers but is not healthy (0.058458ms)
✔ CANARY-1: classifyCanary reports unavailable (exit 2) when the run history cannot be read (0.054459ms)
✔ CANARY-1: classifyCanary reports misconfigured (exit 3) when the worker port answers with a different service (0.047ms)
✔ CANARY-1: classifyCanary applies precedence misconfigured > unavailable > stale > healthy (0.079917ms)
✔ CANARY-1: runCanary pins the worker /health contract against health-response.ok.v1.json (1.73025ms)
✔ CANARY-1: runCanary ignores ingest_ runs and non-success statuses when picking the newest successful run (0.368ms)
✔ CANARY-1: runCanary reports unavailable and exit 2 when the worker refuses the connection (0.402292ms)
✔ CANARY-1: runCanary reports misconfigured and exit 3 for an unusable --worker-url, and never fetches (0.120292ms)
✔ CANARY-1: runCanary never reads Google Sheets and says so with a fixed reason (0.201542ms)
✔ CANARY-1: the default run-history reader is read-only and leaves the run-state directory byte-for-byte untouched (1.716833ms)
✔ CANARY-1: the default run-history reader reports unavailable when the run-state directory is absent (0.412042ms)
✔ CANARY-1: neither the JSON nor the text report leaks tokens, sheet ids, job titles, or run error strings (0.351958ms)
✔ CANARY-1: every emitted reason comes from the fixed enum (0.079917ms)
✔ CANARY-1: formatCanaryReport renders one honest human line per finding (0.226834ms)
✔ CANARY-1: parseArgs accepts the documented flags and rejects everything else (0.297ms)
✔ CANARY-1: an argument error maps to a misconfigured report with exit code 3 (0.060375ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 107.081875
```

Additive read-only cases in the worker store test
(`node --experimental-strip-types --test integrations/browser-use-discovery/tests/state/run-status-store.test.ts`):

```
✔ CANARY-1: listRunStatusSnapshots reads persisted snapshots without opening a writable store (17.848583ms)
✔ CANARY-1: listRunStatusSnapshots skips malformed entries and leaves the directory byte-for-byte untouched (12.989916ms)
✔ CANARY-1: listRunStatusSnapshots returns an empty list for a missing directory and never creates it (0.427208ms)
ℹ tests 16
ℹ suites 0
ℹ pass 16
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 278.528916
```

### 3. Four deterministic fixture invocations of the real CLI, with exit codes

Fixtures: a run-state directory with a 1h-old `completed` snapshot (fresh), one
with a 100h-old `completed` snapshot (stale), an empty one, plus a local
fixture `/health` server serving
`integrations/browser-use-discovery/tests/mocks/health-response.ok.v1.json`
verbatim on 127.0.0.1:18644 and a foreign-service responder on 127.0.0.1:18645.

```
----- healthy -----
$ npm run discovery:canary -- --max-age-hours 24 --worker-url http://127.0.0.1:18644 --state-dir .lane-evidence/canary-fixtures/fresh
discovery canary (read-only)
status: healthy
checked at: 2026-09-01T20:38:01.598Z
worker: http://127.0.0.1:18644 reachable=true http=200 discoveryWorker=true
newest successful run: run_fixture_fresh (completed) finished 2026-09-01T19:34:24.465Z, 1.06h ago (threshold 24h)
sheets: unavailable (sheets_credential_not_available)
reason: worker_healthy
reason: successful_run_fresh
exit code: 0
exit=0

----- stale (run older than threshold) -----
$ npm run discovery:canary -- --max-age-hours 24 --worker-url http://127.0.0.1:18644 --state-dir .lane-evidence/canary-fixtures/stale
discovery canary (read-only)
status: stale
checked at: 2026-09-01T20:38:01.908Z
worker: http://127.0.0.1:18644 reachable=true http=200 discoveryWorker=true
newest successful run: run_fixture_old (completed) finished 2026-08-28T16:34:24.465Z, 100.06h ago (threshold 24h)
sheets: unavailable (sheets_credential_not_available)
reason: worker_healthy
reason: successful_run_stale
exit code: 1
exit=1

----- stale (no successful run) -----
$ npm run discovery:canary -- --max-age-hours 24 --worker-url http://127.0.0.1:18644 --state-dir .lane-evidence/canary-fixtures/empty
discovery canary (read-only)
status: stale
checked at: 2026-09-01T20:38:02.142Z
worker: http://127.0.0.1:18644 reachable=true http=200 discoveryWorker=true
newest successful run: none within the readable run history (threshold 24h)
sheets: unavailable (sheets_credential_not_available)
reason: worker_healthy
reason: no_successful_run
exit code: 1
exit=1

----- unavailable (worker refuses) -----
$ npm run discovery:canary -- --max-age-hours 24 --worker-url http://127.0.0.1:18999 --state-dir .lane-evidence/canary-fixtures/fresh
discovery canary (read-only)
status: unavailable
checked at: 2026-09-01T20:38:02.350Z
worker: http://127.0.0.1:18999 reachable=false http=0 discoveryWorker=false
newest successful run: run_fixture_fresh (completed) finished 2026-09-01T19:34:24.465Z, 1.06h ago (threshold 24h)
sheets: unavailable (sheets_credential_not_available)
reason: worker_unreachable
reason: successful_run_fresh
exit code: 2
exit=2

----- misconfigured (foreign service on the port) -----
$ npm run discovery:canary -- --max-age-hours 24 --worker-url http://127.0.0.1:18645 --state-dir .lane-evidence/canary-fixtures/fresh
discovery canary (read-only)
status: misconfigured
checked at: 2026-09-01T20:38:02.528Z
worker: http://127.0.0.1:18645 reachable=true http=200 discoveryWorker=false
newest successful run: run_fixture_fresh (completed) finished 2026-09-01T19:34:24.465Z, 1.06h ago (threshold 24h)
sheets: unavailable (sheets_credential_not_available)
reason: worker_not_discovery_service
reason: successful_run_fresh
exit code: 3
exit=3

----- misconfigured (unknown flag) -----
$ npm run discovery:canary -- --bogus-flag
discovery canary (read-only)
status: misconfigured
checked at: 2026-09-01T20:38:02.752Z
worker: (no usable worker url) reachable=false http=0 discoveryWorker=false
newest successful run: none within the readable run history (threshold 24h)
sheets: unavailable (sheets_credential_not_available)
reason: unknown_argument
reason: worker_unreachable
reason: run_state_unreadable
exit code: 3
exit=3
```

One status per row of the enum, plus a second `stale` cause and a second
`misconfigured` cause. Exit codes match LD-7 exactly: 0 / 1 / 2 / 3.

### 4. Read-only proof against a dirty run-state directory (real CLI)

A `.tmp-` crash leftover and a malformed snapshot were added to the fresh
fixture directory, sha256 taken before and after a real
`npm run discovery:canary` invocation:

```
$ npm run discovery:canary --silent -- --worker-url http://127.0.0.1:18644 --state-dir .lane-evidence/canary-fixtures/fresh
exit=0
44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a  cnVuX29ycGhhbg.json.tmp-1-2-3
57ca2fec0548f2594eb3bdadf2d22869c89d825df85cb6c778db9deb6ea0cf9e  cnVuX2ZpeHR1cmVfZnJlc2g.json
92072df399cb74703f8e86f450d552bc0bb01eeeb98a90985a1b7772c8fd0016  cnVuX2JhZA.json
--- vs ---
44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a  cnVuX29ycGhhbg.json.tmp-1-2-3
57ca2fec0548f2594eb3bdadf2d22869c89d825df85cb6c778db9deb6ea0cf9e  cnVuX2ZpeHR1cmVfZnJlc2g.json
92072df399cb74703f8e86f450d552bc0bb01eeeb98a90985a1b7772c8fd0016  cnVuX2JhZA.json
RUN-STATE DIRECTORY BYTE-FOR-BYTE UNCHANGED
```

This is the guarantee scout probe #2 was reaching for, proven on the path the
canary actually takes. The same property is pinned by two committed tests
(`tests/discovery-canary.test.mjs` and the additive
`run-status-store.test.ts` cases).

### 5. Repository floor, from this worktree

```
$ npm run typecheck:repo
typecheck:repo exit=0

$ npm run lint:repo
lint:repo exit=0
  > eslint .
  > node scripts/lint-integration-skills.mjs
  OK integrations/openclaw-command-center/SKILL.md

$ npm run test:repo
test:repo exit=0
  contract suites: test:contract, test:ats-contract, test:pipeline-contract,
                   test:pipeline-update-contract, lint:skills — all green
  node --test tests/*.test.mjs        → ℹ tests 2504 · pass 2503 · fail 0 · skipped 0 · todo 1
  npm run test:browser-use-discovery  → ℹ tests 730  · pass 730  · fail 0 · skipped 0 · todo 0

$ git diff --check
diff --check exit=0
```

The single `todo 1` is pre-existing and outside this lane.

Also run, because trap #1 says `node --test tests/*.test.mjs` silently skips
`tests/integration/` and only `npm test` is the real gate:

```
$ npm test
npm test exit=0
ℹ tests 2535
ℹ pass 2534
ℹ fail 0
ℹ skipped 0
ℹ todo 1
```

## Commit, risks, and handoff

**Local commit SHA: `f35074f624b8484a723a5e9edd8e6f7a9a061790`**
(`f35074f`, `feat(discovery-hardening/canary): add a read-only discovery canary (CANARY-1)`)
on `feat/discovery-hardening-canary`. Not pushed. No PR. No remote touched.

Six files, all inside the lane fence:

```
 docs/DISCOVERY-CANARY.md                                        | new
 scripts/discovery-canary.mjs                                    | new
 tests/discovery-canary.test.mjs                                 | new
 package.json                                                    | +2 lines (script + typecheck entry)
 integrations/browser-use-discovery/src/state/run-status-store.ts| +1 export (+1 type made public)
 integrations/browser-use-discovery/tests/state/run-status-store.test.ts | +3 cases
```

**Diff reviewed and secret-scanned.** Grepped the full change for `ya29.`,
`AIza`, `sk-`, `ngrok`, `.ts.net`, `trycloudflare`, private-key headers,
`client_secret`, `refresh_token`, and long opaque tokens. Hits are all benign:
the literal header name `ngrok-skip-browser-warning` (copied verbatim from
`probeHealth`, a header *name*, not a URL or secret), long TypeScript
identifiers, the `typecheck:repo` script string, and the deliberately synthetic
redaction bait in the test (`ya29.fakeACCESStokenVALUE`,
`1AbCdEfGhIjKlMnOpQrStUvWxYz_SHEETID`). No real hostnames, no real Sheet IDs, no
`.env` values, no `config.js` read anywhere.

### Risks

1. **The scout probe's second assertion is still red, deliberately.** Anyone
   re-running `.lane-evidence/scout-worker/canary-run-history-reader.probe.test.ts`
   will see 1 pass / 1 fail. That second test characterizes the *writable*
   store's sweep, which LD-6 says to avoid rather than change. Fixing it would
   mean removing the writer's crash-recovery sweep — a regression. See
   Verification §1 and §4.
2. **`RunStatusSnapshotV1` became a public type.** It is the return type of the
   new export, so it had to be. It is a description of a schema that is already
   written to disk; widening its visibility does not widen any contract.
3. **`empty` counts as success.** LD-7 says so explicitly, and the doc says so
   loudly, but an operator could reasonably read "healthy" as "found jobs". It
   means "the pipeline ran end to end". Worth Emilio's eye.
4. **The canary trusts the local run-state directory as the record of truth.**
   If a user's worker is configured with a non-default
   `BROWSER_USE_DISCOVERY_RUN_STATE_DIR`, the default `--state-dir` will report
   `run_state_unreadable` (unavailable, exit 2) rather than silently guessing.
   Honest, but it means `--state-dir` is required for those setups. The canary
   does **not** read the worker's env to auto-discover this, because that is a
   config read the lane fence does not cover — flagged for a follow-up if
   Emilio wants it.
5. **A startup race can look like a defect.** While capturing evidence, one
   invocation against a fixture server that had not finished binding reported
   `worker_unreachable` / exit 2. That is correct behavior (the port genuinely
   was not accepting yet), not a bug — noted so nobody chases it.

### Handoff to the integrator

- **Nothing needed outside the fence.** No file outside the lane fence was
  edited, and no cross-lane change is requested.
- **Merge-order note (LD-6):** E rebases onto C's webhook change. The only
  shared file is `run-status-store.ts`, and this lane's change is purely
  additive at the bottom of the export surface (one new function + one
  `interface` → `export interface`). Lane C does not touch that file per LD-6,
  so no conflict is expected. If C did land something there, this addition is
  self-contained and moves cleanly.
- **`package.json` is Lane E's exclusively.** Both edits are single-line
  insertions immediately after their `discovery-keep-alive` counterparts, so
  they rebase cleanly even if another lane's script lines land nearby.
- **Trap #2 is handled:** `scripts/discovery-canary.mjs` is registered in
  `typecheck:repo`, so it cannot pass typecheck while broken.
- **QA can reproduce every status without a live worker.** The fixture recipe is
  in Verification §3; the fixture health server and run-state fixtures are in
  the gitignored `.lane-evidence/` (nothing deleted).

### Vehicle

Running as Opus 5 (`claude --model opus --effort high`), as the ground rules
require. No sub-agents were spawned; all work done in-lane.
