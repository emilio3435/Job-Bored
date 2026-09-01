# Lane report: repair-canary

## Scope and ownership

Repair lane E · claim **CANARY-1**, fixing QA findings **MINOR-6**, **MINOR-7**, **MINOR-8** from
`.lane-evidence/qa-report.md`. Fresh lane on `feat/discovery-hardening-canary`, worktree
`/private/tmp/Job-Bored-discovery-hardening-canary`, on top of predecessor commit `f35074f`.

Fence (same as Lane E). Files actually touched:

| Path | Touched | Why |
|---|---|---|
| `scripts/discovery-canary.mjs` | yes | MINOR-6 not-checked semantics, MINOR-7 `REPORT_ONLY_REASONS`, MINOR-8 exported `runCli` |
| `tests/discovery-canary.test.mjs` | yes | 4 new cases (one per finding, two for MINOR-7) + 1 existing case realigned |
| `docs/DISCOVERY-CANARY.md` | yes | MINOR-7 reason table footnote, `not checked` example, `runCli` note |
| `package.json` | **no** | no change needed; `scripts/discovery-canary.mjs` is already registered in `typecheck:repo` (trap #2 already handled) |
| `integrations/browser-use-discovery/src/state/run-status-store.ts` | **no** | no change needed |

Goal met: **the canary never asserts a fact it did not check, its doc matches its code, and every
documented exit code has a test.**

## Baseline and RED evidence

The three findings are behavioral, so RED was captured two ways.

### RED 1 — the new tests cannot even load (MINOR-8: the CLI is unreachable)

`npm test -- tests/discovery-canary.test.mjs`, with the new cases written and the implementation
untouched:

```
> command-center@0.1.0 test
> node scripts/run-tests.mjs tests/discovery-canary.test.mjs

file:///private/tmp/Job-Bored-discovery-hardening-canary/tests/discovery-canary.test.mjs:10
  CANARY_REASONS,
  ^^^^^^^^^^^^^^
SyntaxError: The requested module '../scripts/discovery-canary.mjs' does not provide an export named 'CANARY_REASONS'
    at #asyncInstantiate (node:internal/modules/esm/module_job:302:21)
    at async ModuleJob.run (node:internal/modules/esm/module_job:405:5)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:660:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v24.13.0
✖ tests/discovery-canary.test.mjs (65.177958ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 68.860875
```

That is real but blunt (a module-level failure hides the per-finding gaps), so a second RED probe
(`.lane-evidence/repair-red-behavior.probe.mjs`) exercised the **shipped** CLI directly.

### RED 2 — the behavioral gaps, against the pre-repair canary

```
--- MINOR-6: `--bogus-flag --json` reasons (nothing was probed or read) ---
exit= 3
reasons = ["unknown_argument","worker_unreachable","run_state_unreadable"]
worker  = {"healthUrlOrigin":"","reachable":false,"statusCode":0,"isDiscoveryWorker":false}
report.worker.checked = undefined
report.runHistory = undefined
FABRICATED: [ 'worker_unreachable', 'run_state_unreadable' ]

--- MINOR-7: doc reason table vs CANARY_REASONS in source ---
code CANARY_REASONS = ["worker_healthy","successful_run_fresh","no_successful_run","successful_run_stale","worker_unreachable","worker_unhealthy","run_state_unreadable","worker_not_discovery_service","worker_url_invalid","unknown_argument","invalid_max_age_hours","sheets_credential_not_available"]
doc rows            = ["worker_healthy","successful_run_fresh","no_successful_run","successful_run_stale","worker_unreachable","worker_unhealthy","run_state_unreadable","sheets_credential_not_available","worker_not_discovery_service","worker_url_invalid","unknown_argument","invalid_max_age_hours"]
doc footnoted (report-only) = []
emitted-anywhere-in-code check: 'sheets_credential_not_available' pushed into reasons?  false

--- MINOR-8: is the internal-error path reachable from a test? ---
exports: CANARY_EXIT_CODES, classifyCanary, formatCanaryReport, parseArgs, runCanary
runCli exported = false
```

Reading it: MINOR-6 — `--bogus-flag` printed **two fabricated reasons** after probing nothing and
reading nothing. MINOR-7 — the doc table listed `sheets_credential_not_available` as emittable with
**no footnote**, while the code never pushes it. MINOR-8 — `runCli` was not exported, so exit 4 was
unreachable from any test.

## Implementation

Three changes, one per finding, nothing else.

### MINOR-6 — "not checked" is a first-class state

`classifyCanary` now treats a `null`/absent `health` or `runHistory` as **NOT CHECKED** and emits no
reason for it (previously `input.health || {}` silently became "unreachable"). Two call sites feed it:

- `buildArgumentErrorReport` passes `health: null, runHistory: null` — a parse error is decided before
  any probe or read happens, so only the config-error reason is a real finding.
- `runCanary` passes `health: null` when `buildLocalHealthUrl` yields nothing. That path never fetched
  either, so its old `worker_unreachable` was equally fabricated. The run history **is** still read
  there, so it still reports honestly.

The report carries the distinction rather than hiding it: `worker.checked` and a new
`runHistory: { checked, available }`. `formatCanaryReport` renders `worker: not checked` /
`newest successful run: not checked` instead of `reachable=false`. Status and exit code are unchanged
(`misconfigured`, 3).

### MINOR-7 — report-only reasons are named as such

`REPORT_ONLY_REASONS = new Set(["sheets_credential_not_available"])`. `classifyCanary` refuses to push
any member of it, so the invariant is enforced in code and not just by the absence of a `push` call.
The doc table row is footnoted `†` with the reason it must stay report-only (it claims `unavailable`,
so emitting it would pin the canary at `unavailable` forever). A test parses the doc's table and
asserts the non-footnoted rows equal `Object.keys(CANARY_REASONS)` minus `REPORT_ONLY_REASONS`, the
footnoted rows equal `REPORT_ONLY_REASONS`, and every documented status string matches the code — so
the doc cannot drift from the enum again.

### MINOR-8 — the CLI is an exported function

`runCli(argv, { stdout, stderr, runCanary, now, fetchImpl, readRunHistory }) → exit code` holds the
whole CLI body; the `import.meta.url` guard is now one line, `process.exitCode = await runCli(...)`.
A test injects a `runCanary` that throws and asserts exit 4.

The internal-error line is redacted to the error **name** only
(`[discovery-canary] internal error: Error. This is a bug in the canary itself; nothing was changed.`).
The old line printed `error.message`, which for the realistic case (an `ENOENT` on the run-state
directory) carries an absolute path through the user's home directory. Same reason the health probe
already drops its error text.

## Verification and raw output

### 1. GREEN — the behavioral probe re-run verbatim, plus the read-only invariant

```
=== read-only proof (dirty fixture dir, real CLI) ===
exit=0
44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a  .lane-evidence/canary-fixtures/fresh/cnVuX29ycGhhbg.json.tmp-1-2-3
57ca2fec0548f2594eb3bdadf2d22869c89d825df85cb6c778db9deb6ea0cf9e  .lane-evidence/canary-fixtures/fresh/cnVuX2ZpeHR1cmVfZnJlc2g.json
92072df399cb74703f8e86f450d552bc0bb01eeeb98a90985a1b7772c8fd0016  .lane-evidence/canary-fixtures/fresh/cnVuX2JhZA.json
--- vs ---
44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a  .lane-evidence/canary-fixtures/fresh/cnVuX29ycGhhbg.json.tmp-1-2-3
57ca2fec0548f2594eb3bdadf2d22869c89d825df85cb6c778db9deb6ea0cf9e  .lane-evidence/canary-fixtures/fresh/cnVuX2ZpeHR1cmVfZnJlc2g.json
92072df399cb74703f8e86f450d552bc0bb01eeeb98a90985a1b7772c8fd0016  .lane-evidence/canary-fixtures/fresh/cnVuX2JhZA.json
RUN-STATE DIRECTORY BYTE-FOR-BYTE UNCHANGED

=== MINOR-6/7/8 behavior probe, re-run verbatim (GREEN) ===
--- MINOR-6: `--bogus-flag --json` reasons (nothing was probed or read) ---
exit= 3
reasons = ["unknown_argument"]
worker  = {"checked":false,"healthUrlOrigin":""}
report.worker.checked = false
report.runHistory = {"checked":false,"available":false}
FABRICATED: []

--- MINOR-7: doc reason table vs CANARY_REASONS in source ---
code CANARY_REASONS = ["worker_healthy","successful_run_fresh","no_successful_run","successful_run_stale","worker_unreachable","worker_unhealthy","run_state_unreadable","worker_not_discovery_service","worker_url_invalid","unknown_argument","invalid_max_age_hours","sheets_credential_not_available"]
doc rows            = ["worker_healthy","successful_run_fresh","no_successful_run","successful_run_stale","worker_unreachable","worker_unhealthy","run_state_unreadable","worker_not_discovery_service","worker_url_invalid","unknown_argument","invalid_max_age_hours","sheets_credential_not_available"]
doc footnoted (report-only) = ["sheets_credential_not_available"]
emitted-anywhere-in-code check: 'sheets_credential_not_available' pushed into reasons?  false

--- MINOR-8: is the internal-error path reachable from a test? ---
exports: CANARY_EXIT_CODES, CANARY_REASONS, REPORT_ONLY_REASONS, classifyCanary, formatCanaryReport, parseArgs, runCanary, runCli
runCli exported = true
```

`FABRICATED: []`, the doc footnote now matches `REPORT_ONLY_REASONS`, `runCli exported = true`, and
the run-state directory (with a `.tmp-` crash leftover and a malformed snapshot in it) is still
byte-for-byte unchanged after a real CLI invocation.

### 2. Lane gate — `npm test -- tests/discovery-canary.test.mjs`

```
> command-center@0.1.0 test
> node scripts/run-tests.mjs tests/discovery-canary.test.mjs

✔ CANARY-1: classifyCanary reports healthy (exit 0) when the worker is the discovery worker and a recent successful run exists (0.719666ms)
✔ CANARY-1: classifyCanary reports stale (exit 1) when no successful discovery run has ever landed (0.141584ms)
✔ CANARY-1: classifyCanary reports stale (exit 1) when the newest successful run is older than --max-age-hours (0.059583ms)
✔ CANARY-1: classifyCanary reports unavailable (exit 2) when the worker is unreachable (0.047084ms)
✔ CANARY-1: classifyCanary reports unavailable (exit 2) when the worker answers but is not healthy (0.042916ms)
✔ CANARY-1: classifyCanary reports unavailable (exit 2) when the run history cannot be read (0.063375ms)
✔ CANARY-1: classifyCanary reports misconfigured (exit 3) when the worker port answers with a different service (0.039ms)
✔ CANARY-1: classifyCanary applies precedence misconfigured > unavailable > stale > healthy (0.1355ms)
✔ CANARY-1: runCanary pins the worker /health contract against health-response.ok.v1.json (1.34ms)
✔ CANARY-1: runCanary ignores ingest_ runs and non-success statuses when picking the newest successful run (0.465542ms)
✔ CANARY-1: runCanary reports unavailable and exit 2 when the worker refuses the connection (0.210459ms)
✔ CANARY-1: runCanary reports misconfigured and exit 3 for an unusable --worker-url, and never fetches (0.115542ms)
✔ CANARY-1: runCanary never reads Google Sheets and says so with a fixed reason (0.230792ms)
✔ CANARY-1: the default run-history reader is read-only and leaves the run-state directory byte-for-byte untouched (1.758042ms)
✔ CANARY-1: the default run-history reader reports unavailable when the run-state directory is absent (0.324ms)
✔ CANARY-1: neither the JSON nor the text report leaks tokens, sheet ids, job titles, or run error strings (0.205333ms)
✔ CANARY-1: every emitted reason comes from the fixed enum (0.0495ms)
✔ CANARY-1: formatCanaryReport renders one honest human line per finding (0.134792ms)
✔ CANARY-1: parseArgs accepts the documented flags and rejects everything else (0.237625ms)
✔ CANARY-1: an argument error maps to a misconfigured report with exit code 3 (0.039667ms)
✔ CANARY-1: an argument error reports only the config-error reason and never asserts a fact it did not check (MINOR-6) (0.195417ms)
✔ CANARY-1: the documented reason table matches CANARY_REASONS exactly (MINOR-7) (0.344ms)
✔ CANARY-1: report-only reasons can never reach `reasons` (MINOR-7) (0.048875ms)
✔ CANARY-1: an unexpected internal error exits 4 with a redacted one-line message (MINOR-8) (0.139292ms)
ℹ tests 24
ℹ suites 0
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 78.466625
```

24/24, including the four new cases and the realigned argument-error case.

### 3. The CLI status invocations against fixtures

Fixture health server (`.lane-evidence/fixture-health-server.mjs`) serving
`health-response.ok.v1.json` verbatim on 127.0.0.1:18644 and a foreign-service responder on
127.0.0.1:18645; run-state fixtures under `.lane-evidence/canary-fixtures/`.

```
----- healthy -----
$ npm run discovery:canary --silent -- --max-age-hours 24 --worker-url http://127.0.0.1:18644 --state-dir .lane-evidence/canary-fixtures/fresh
discovery canary (read-only)
status: healthy
checked at: 2026-09-01T22:01:08.334Z
worker: http://127.0.0.1:18644 reachable=true http=200 discoveryWorker=true
newest successful run: run_fixture_fresh (completed) finished 2026-09-01T19:34:24.465Z, 2.45h ago (threshold 24h)
sheets: unavailable (sheets_credential_not_available)
reason: worker_healthy
reason: successful_run_fresh
exit code: 0
exit=0

----- stale (run older than threshold) -----
$ npm run discovery:canary --silent -- --max-age-hours 24 --worker-url http://127.0.0.1:18644 --state-dir .lane-evidence/canary-fixtures/stale
discovery canary (read-only)
status: stale
checked at: 2026-09-01T22:01:08.496Z
worker: http://127.0.0.1:18644 reachable=true http=200 discoveryWorker=true
newest successful run: run_fixture_old (completed) finished 2026-08-28T16:34:24.465Z, 101.45h ago (threshold 24h)
sheets: unavailable (sheets_credential_not_available)
reason: worker_healthy
reason: successful_run_stale
exit code: 1
exit=1

----- stale (no successful run) -----
$ npm run discovery:canary --silent -- --max-age-hours 24 --worker-url http://127.0.0.1:18644 --state-dir .lane-evidence/canary-fixtures/empty
discovery canary (read-only)
status: stale
checked at: 2026-09-01T22:01:08.654Z
worker: http://127.0.0.1:18644 reachable=true http=200 discoveryWorker=true
newest successful run: none within the readable run history (threshold 24h)
sheets: unavailable (sheets_credential_not_available)
reason: worker_healthy
reason: no_successful_run
exit code: 1
exit=1

----- unavailable (worker refuses) -----
$ npm run discovery:canary --silent -- --max-age-hours 24 --worker-url http://127.0.0.1:18999 --state-dir .lane-evidence/canary-fixtures/fresh
discovery canary (read-only)
status: unavailable
checked at: 2026-09-01T22:01:08.812Z
worker: http://127.0.0.1:18999 reachable=false http=0 discoveryWorker=false
newest successful run: run_fixture_fresh (completed) finished 2026-09-01T19:34:24.465Z, 2.45h ago (threshold 24h)
sheets: unavailable (sheets_credential_not_available)
reason: worker_unreachable
reason: successful_run_fresh
exit code: 2
exit=2

----- misconfigured (foreign service on the port) -----
$ npm run discovery:canary --silent -- --max-age-hours 24 --worker-url http://127.0.0.1:18645 --state-dir .lane-evidence/canary-fixtures/fresh
discovery canary (read-only)
status: misconfigured
checked at: 2026-09-01T22:01:08.968Z
worker: http://127.0.0.1:18645 reachable=true http=200 discoveryWorker=false
newest successful run: run_fixture_fresh (completed) finished 2026-09-01T19:34:24.465Z, 2.45h ago (threshold 24h)
sheets: unavailable (sheets_credential_not_available)
reason: worker_not_discovery_service
reason: successful_run_fresh
exit code: 3
exit=3

----- misconfigured (unknown flag) — MINOR-6 -----
$ npm run discovery:canary --silent -- --bogus-flag
discovery canary (read-only)
status: misconfigured
checked at: 2026-09-01T22:01:09.126Z
worker: not checked
newest successful run: not checked
sheets: unavailable (sheets_credential_not_available)
reason: unknown_argument
exit code: 3
exit=3

----- misconfigured (unknown flag, json) — MINOR-6 -----
$ npm run discovery:canary --silent -- --bogus-flag --json
{
  "status": "misconfigured",
  "reasons": [
    "unknown_argument"
  ],
  "exitCode": 3,
  "checkedAt": "2026-09-01T22:01:09.269Z",
  "maxAgeHours": 24,
  "worker": {
    "checked": false,
    "healthUrlOrigin": ""
  },
  "runHistory": {
    "checked": false,
    "available": false
  },
  "run": null,
  "sheets": {
    "status": "unavailable",
    "reason": "sheets_credential_not_available"
  }
}
exit=3

----- help -----
$ npm run discovery:canary --silent -- --help
discovery-canary (read-only)

Usage:
  node scripts/discovery-canary.mjs
  node scripts/discovery-canary.mjs --max-age-hours 24 --json
  node scripts/discovery-canary.mjs --state-dir <dir> --worker-url <origin>

Flags:
  --max-age-hours <n>   How fresh the newest successful run must be (integer >= 1, default 24).
  --json                Emit the machine-readable report instead of text.
  --state-dir <dir>     Run-state snapshot directory (default ~/.jobbored/browser-use-discovery/run-state).
  --worker-url <origin> Local worker origin (default http://127.0.0.1:8644).
  --help, -h            Show this help.

Exit codes: 0 healthy, 1 stale, 2 unavailable, 3 misconfigured, 4 internal error.
exit=0
```

Every documented status and exit code, plus `--help` (0). The unknown-flag rows are the MINOR-6 fix in
the real CLI: one reason, `worker: not checked`, `newest successful run: not checked`, still exit 3.

Exit code **4** is verified by test rather than by CLI — reaching it from the shell requires injecting
a fault into `runCanary`, which is exactly what MINOR-8 asked to make possible.

### 4. Repository floor, from this worktree

```
$ npm run typecheck:repo
typecheck:repo exit=0

$ npm run lint:repo
lint:repo exit=0

$ git diff --check
git diff --check exit=0

$ npm run test:repo
test:repo exit=0
  node --test tests/*.test.mjs        → ℹ tests 2508 · pass 2507 · fail 0 · skipped 0 · todo 1
  npm run test:browser-use-discovery  → ℹ tests 730  · pass 730  · fail 0 · skipped 0 · todo 0
```

The single `todo 1` is pre-existing and outside this lane (it is in the predecessor's floor too).

Also run, because ground-rules trap #1 says `node --test tests/*.test.mjs` silently skips
`tests/integration/` and only `npm test` is the real gate:

```
$ npm test
npm test exit=0
ℹ tests 2539
ℹ pass 2538
ℹ fail 0
ℹ skipped 0
ℹ todo 1
```

(2535 → 2539: the four new cases.)

## Commit, risks, and handoff

**Local commit SHA: `852eea629bc3d3e4774d49c4e174feefb7eb610c`** (`852eea6`,
`fix(discovery-hardening/canary): never assert an unchecked fact (MINOR-6/7/8)`) on
`feat/discovery-hardening-canary`, on top of `f35074f`. Not pushed. No PR. No remote touched.

```
 docs/DISCOVERY-CANARY.md        |  34 ++++++-
 scripts/discovery-canary.mjs    | 205 ++++++++++++++++++++++++++--------------
 tests/discovery-canary.test.mjs | 127 ++++++++++++++++++++++++-
 3 files changed, 291 insertions(+), 75 deletions(-)
```

**Diff reviewed and secret-scanned.** `git diff | grep -nE "ya29\.|AIza|sk-[A-Za-z0-9]|ngrok|\.ts\.net|trycloudflare|client_secret|refresh_token|BEGIN [A-Z ]*PRIVATE KEY"` → no hits. No real hostnames, no real Sheet IDs, no `.env` values; `config.js` is not read anywhere. Only `127.0.0.1` fixture ports appear.

### Risks

1. **The JSON report shape changed** (additively, plus one removal in one case). `worker` gained
   `checked`, and a new top-level `runHistory: { checked, available }` appeared. On the
   never-probed path `worker` no longer carries `reachable`/`statusCode`/`isDiscoveryWorker` at all —
   deliberately, since printing them was the bug. Any consumer that reads `report.worker.reachable`
   unconditionally must now check `report.worker.checked` first. Nothing in this repo consumes the
   JSON yet; the canary is a fresh CLI.
2. **`worker_url_invalid` reports one fewer reason than before.** `npm run discovery:canary -- --worker-url "not a url"`
   used to print `worker_url_invalid` + `worker_unreachable`; it now prints `worker_url_invalid` plus
   the honest run-history finding. Status and exit code are unchanged. This goes slightly beyond the
   literal `--bogus-flag` case in the kickoff, but it is the same defect — nothing was probed there
   either — and MINOR-6's stated fix ("when `configErrors` is non-empty, emit only those reasons")
   covers it. Called out because it is a second, non-obvious behavior change.
3. **The internal-error line no longer carries the message.** Debugging a canary crash now needs a
   local re-run rather than the operator's paste. That is the deliberate trade for MINOR-8's "no
   stack, no paths"; the error *name* is kept so the class of failure is still visible.
4. **The doc-vs-enum test parses Markdown.** It matches `^| \`name\`( †)? | status |$` rows. Reformatting
   that table (a prettier pass, a column added) will fail the test rather than silently pass. That is
   the intended failure direction, but it is a coupling the next editor should know about.
5. **Predecessor risks 3–5 are unchanged** (`empty` counts as success; a non-default
   `BROWSER_USE_DISCOVERY_RUN_STATE_DIR` needs `--state-dir`; a not-yet-bound worker correctly reads
   as `worker_unreachable`). Nothing in this repair touches them.

### Handoff to the integrator

- **Nothing needed outside the fence.** No file outside the Lane E fence was edited; no cross-lane
  change is requested. `package.json` and `run-status-store.ts` were confirmed to need no change.
- **This is a second commit on the same branch, not a replacement.** `f35074f` (feature) then
  `852eea6` (repair). Squash or keep as the program prefers; they are independently green.
- **Not addressed here, by design:** MINOR-9, MINOR-10, MINOR-11 from the QA report are other lanes'
  files (webhook suite, `discovery-drawer.js`, `discovery-status-handoff.js`) and outside this fence.
- **Evidence is in the gitignored `.lane-evidence/`**: `repair-red-behavior.probe.mjs` / `.txt` (RED),
  `repair-green-behavior.txt` (GREEN + read-only proof), `repair-cli-runs.txt` (CLI transcript),
  `repair-tc.log`, `repair-lint.log`, `repair-test-repo.log`, `repair-npmtest.log` (floor). Nothing
  deleted.

### Vehicle

Running as Opus 5 (`claude --model opus --effort high`), as the ground rules require. No sub-agents
were spawned; all work done in-lane.
