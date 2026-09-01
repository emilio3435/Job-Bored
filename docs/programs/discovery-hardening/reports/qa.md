# Lane report: qa

Read-only adversarial review of the integrated `feat/discovery-hardening` branch.
Worktree `/private/tmp/Job-Bored-discovery-hardening-qa`, branch `feat/discovery-hardening-qa`.
Reviewed HEAD `a116683` · base `81e313a` · lanes merged `d6b9799 f92b3b8 66bebe2 70b966d 76e04c5` + integrator `a7dcc4c`.

**Verdict: no BLOCKER. 2 MAJOR, 10 MINOR.** All five claims are met by code that actually runs;
the MAJORs are a load-bearing branch with zero test coverage (proved by mutation) and a test-file
rationale that overstates what the LD-3 guard catches.

---

## Scope and ownership

Read-only. **My only write to the repository tree is this file** (gitignored at `.gitignore:76,80`).
Everything else I produced is scratch under `.lane-evidence/qa/` (gitignored at `.gitignore:79`).
No product file, no test file, no doc was changed. Nothing committed, nothing pushed, no remote touched.

```
$ git status --porcelain
(empty)
```

### Diff-to-goal traceability (kickoff item 1)

```
$ git diff 81e313a..HEAD --stat
 .github/workflows/pages.yml                        |   3 +
 .gitignore                                         |   2 +
 discovery-run-tracker.js                           |  29 ++
 discovery-status-handoff.js                        |  92 +++-
 docs/DISCOVERY-CANARY.md                           | 133 ++++++
 docs/programs/discovery-hardening/GROUND-RULES.md  |  70 +++
 .../discovery-hardening/INTEGRATION-LOG.md         |  54 +++
 .../programs/discovery-hardening/KICKOFF-assets.md |  27 ++
 .../programs/discovery-hardening/KICKOFF-canary.md |  29 ++
 .../discovery-hardening/KICKOFF-lifecycle.md       |  31 ++
 docs/programs/discovery-hardening/KICKOFF-qa.md    |  19 +
 .../discovery-hardening/KICKOFF-scout-browser.md   |  28 ++
 .../discovery-hardening/KICKOFF-scout-worker.md    |  29 ++
 .../discovery-hardening/KICKOFF-scrape-e2e.md      |  31 ++
 .../KICKOFF-stable-transport.md                    |  33 ++
 docs/programs/discovery-hardening/PROGRAM-SPEC.md  | 107 +++++
 docs/programs/discovery-hardening/SCOUT-browser.md | 502 ++++++++++++++++++++
 docs/programs/discovery-hardening/SCOUT-worker.md  | 498 ++++++++++++++++++++
 .../programs/discovery-hardening/reports/assets.md | 308 +++++++++++++
 .../programs/discovery-hardening/reports/canary.md | 507 ++++++++++++++++++++
 .../discovery-hardening/reports/lifecycle.md       | 408 +++++++++++++++++
 .../discovery-hardening/reports/scrape-e2e.md      | 310 +++++++++++++
 .../reports/stable-transport.md                    | 435 ++++++++++++++++++
 .../src/state/run-status-store.ts                  |  40 +-
 .../src/webhook/handle-discovery-webhook.ts        |  77 ++++
 .../tests/state/run-status-store.test.ts           | 121 +++++
 .../tests/webhook/handle-discovery-webhook.test.ts |  11 +
 .../tests/webhook/lifecycle-idempotency.test.ts    | 510 +++++++++++++++++++++
 package.json                                       |   3 +-
 scripts/assemble-index.mjs                         | 172 ++++++-
 scripts/discovery-canary.mjs                       | 435 ++++++++++++++++++
 tests/discovery-canary.test.mjs                    | 505 ++++++++++++++++++++
 tests/discovery-lifecycle-poller.test.mjs          | 348 ++++++++++++++
 tests/discovery-lifecycle.test.mjs                 | 150 ++++++
 tests/discovery-stable-transport.test.mjs          | 311 +++++++++++++
 tests/e2e-fixtures/hermetic-harness.mjs            |  29 ++
 tests/e2e-fixtures/job-posting-json-ld.html        |  31 ++
 tests/e2e-fixtures/scrape-job-fixtures.mjs         | 131 ++++++
 tests/e2e-journey/critical-journey.spec.mjs        | 135 +++++-
 tests/pages-deploy-contract.test.mjs               | 288 +++++++++++-
 40 files changed, 6961 insertions(+), 21 deletions(-)
```

Per-merge file lists, checked against the LD-8 fence table:

| Merge | Lane | Files | Claim | Locked decision | Fence |
|---|---|---|---|---|---|
| `d6b9799` | A assets | `.github/workflows/pages.yml`, `scripts/assemble-index.mjs`, `tests/pages-deploy-contract.test.mjs` | ASSET-1 | LD-1 | **exact match** — `index.html` untouched, transform in `--write` only |
| `f92b3b8` | B scrape-e2e | `tests/e2e-fixtures/hermetic-harness.mjs`, `tests/e2e-fixtures/job-posting-json-ld.html`, `tests/e2e-fixtures/scrape-job-fixtures.mjs`, `tests/e2e-journey/critical-journey.spec.mjs` | SCRAPE-E2E-1 | LD-2 | **exact match** — zero product edits |
| `66bebe2` | C lifecycle | `…/src/webhook/handle-discovery-webhook.ts`, `…/tests/webhook/handle-discovery-webhook.test.ts`, `…/tests/webhook/lifecycle-idempotency.test.ts`, `tests/discovery-lifecycle.test.mjs` | LIFECYCLE-1 | LD-3, LD-4 (browser side characterization only) | **inside fence, narrower** — `src/server.ts` not touched; the store already passes `runStatusStore` (`src/server.ts:1582`) so no wiring was needed |
| `70b966d` | D stable-transport | `discovery-status-handoff.js`, `discovery-run-tracker.js`, `tests/discovery-lifecycle-poller.test.mjs`, `tests/discovery-stable-transport.test.mjs` | STABLE-1 + LIFECYCLE-1 (poller) | LD-4, LD-5 | **inside fence, narrower** — `discovery-readiness.js` and `tests/run-status-honesty.test.mjs` untouched, as LD-5 preferred |
| `76e04c5` | E canary | `docs/DISCOVERY-CANARY.md`, `…/src/state/run-status-store.ts`, `…/tests/state/run-status-store.test.ts`, `package.json`, `scripts/discovery-canary.mjs`, `tests/discovery-canary.test.mjs` | CANARY-1 | LD-6, LD-7 | **exact match** |
| `a7dcc4c` | integrator | `.gitignore`, `package.json`, `INTEGRATION-LOG.md` | — | Lane D + Lane A handoffs, ledger row 6 | orchestrator-owned; both entries traced to a lane handoff |
| (base docs) | Fable | `docs/programs/discovery-hardening/**` | — | orchestrator-owned per spec ("Only Fable owns `docs/programs/discovery-hardening/*`") | — |

**No changed line lacks a claim.** Every non-doc file maps to exactly one claim and one locked decision,
and no lane wrote outside its fence. The two integrator lines in `package.json` are
`"discovery:canary"` + `node --check scripts/discovery-canary.mjs` (Lane E, LD-8) and
`node --check discovery-run-tracker.js` (Lane D handoff, ledger row 6 — Lane D could not add it because
`package.json` was Lane E's fence). Ground-rules trap #2 (a new root browser JS file missing from
`typecheck:repo`) is therefore closed; `discovery-run-tracker.js` was pre-existing but newly edited.

---

## Baseline and RED evidence

I did not re-run the lanes' RED probes (they are archived verbatim in
`docs/programs/discovery-hardening/reports/*.md` and in `PROGRAM-SPEC.md`'s baseline table).
Instead I re-established the baseline adversarially, by **mutation**: for each claim I asked whether
an arbitrary reimplementation could still pass the tests the lanes shipped. That produced MAJOR-1 below.

Two scratch probes I wrote for that purpose live in `.lane-evidence/qa/`:
`qa-mutation-poller.probe.mjs` and `qa-asset1-parser.probe.mjs`, plus
`qa-lifecycle-failed-redelivery.probe.ts`. None of them touches a repo file.

---

## Implementation

Nothing implemented. This lane is findings-only.

---

## Verification and raw output

Everything below was run by me, from this worktree, on `a116683`. Raw logs in `.lane-evidence/qa/`.

### `npm run typecheck:repo` — GREEN

```
> command-center@0.1.0 typecheck:repo
> npm run typecheck:browser-use-discovery && node --check app.js && … && node --check discovery-status-handoff.js && node --check discovery-run-tracker.js && … && node --check scripts/discovery-canary.mjs && npm run typecheck:server && …

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

EXIT=0
```

### `npm run lint:repo` — GREEN

```
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
EXIT=0
```

### `npm run test:repo` — GREEN

```
ℹ tests 747
ℹ suites 2
ℹ pass 747
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2111.078334
EXIT=0
```

### `npm test` (the real CI gate — ground-rules trap #1) — GREEN

```
ℹ tests 2573
ℹ suites 605
ℹ pass 2572
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6334.167958
EXIT=0
```

Baseline on `81e313a` was `2515 tests · 2514 pass · 0 fail · 1 todo` (INTEGRATION-LOG). Net **+58 root tests, 0 lost**.
The single `todo` is `tests/submission-record-audit.test.mjs` "persists and can remove the canonical
submission evidence record", pre-existing on the base — confirmed:

```
$ git grep -n "todo" 81e313a -- tests/submission-record-audit.test.mjs
81e313a:tests/submission-record-audit.test.mjs:18:  todo: "blocked on the canonical-ownership gate; no legal Sheet column or IndexedDB store",
```

### `npm run test:browser-use-discovery` — GREEN

```
ℹ tests 747
ℹ pass 747
ℹ fail 0
ℹ skipped 0
ℹ todo 0
EXIT=0
```
Baseline was 727 → **+20** (17 `lifecycle-idempotency.test.ts` + 3 `run-status-store.test.ts`).

### `npm test -- tests/pages-deploy-contract.test.mjs` — GREEN (12/12)

```
  ✔ ASSET-1: the Pages workflow verifies the built _site against its own assets (0.073625ms)
  ✔ ASSET-1: verifySiteAssets accepts a site whose HTML and assets agree (0.812333ms)
  ✔ ASSET-1: verifySiteAssets rejects a site whose HTML outruns its assets (0.734166ms)
  ✔ ASSET-1: verifySiteAssets rejects an unstamped asset that is not the config placeholder (0.407625ms)
✔ ASSET-1: deployed HTML cannot reference stale browser JavaScript (28.823125ms)
ℹ tests 12
ℹ pass 12
ℹ fail 0
ℹ skipped 0
ℹ todo 0
EXIT=0
```

### `npm run test:contract:all` — GREEN (webhook ack schema unchanged)

```
> command-center@0.1.0 test:contract
> node scripts/test-contract.mjs

OK schema: examples/discovery-webhook-request.v1.json
OK schema: examples/discovery-webhook-request.v1-with-profile.json
OK schema: examples/discovery-webhook-request.v1-preview-parity.json
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
OK discovery-readiness.js delegates to discovery-payload.js
…
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md
EXIT=0
```
`integrations/browser-use-discovery/src/contracts.ts` is **not in the diff at all** — LD-3's promise that the
webhook request/ack schema does not change holds, and `test:contract:all` needed no contract edits.

### `npm run test:e2e-smoke` — GREEN (6/6)

```
Running 6 tests using 1 worker
  ✓  1 boot-smoke.spec.mjs:93:1 › greenfield boot produces zero console errors (3.4s)
  ✓  2 boot-smoke.spec.mjs:102:1 › every <script src> in the served HTML returns 200 (311ms)
  ✓  3 boot-smoke.spec.mjs:128:1 › screen S0 — the demo board — is the cold-start surface, credential gate hidden (303ms)
  ✓  4 boot-smoke.spec.mjs:144:1 › demo cards render watermarked, with a fit score and a why-it-fits line (301ms)
  ✓  5 boot-smoke.spec.mjs:161:1 › JobBoredOneFlow.open() renders a beat, and its primary action is hittable (380ms)
  ✓  6 boot-smoke.spec.mjs:182:1 › requestDiscoverySetup() renders the wizard shell with a usable primary action (400ms)
  6 passed (5.6s)
EXIT=0
```

### `npm run test:e2e-journey` — GREEN on re-run; **one flake on the first run** (see MINOR-5)

First run, 8/9 — the failure is a **pre-existing test no lane touched**:

```
  ✘  4 critical-journey.spec.mjs:265:1 › should treat closing the flow as pausing — Esc returns to the board and re-entry resumes the saved beat (5.6s)

    Error: expect(locator).toBeHidden() failed
    Locator:  locator('#oneFlowMount')
    Expected: hidden
    Received: visible
    Timeout:  5000ms
      - waiting for locator('#oneFlowMount')
        14 × locator resolved to <div id="oneFlowMount" aria-hidden="false" class="discovery-setup-wizard-root oneflow-root">…</div>
           - unexpected value "visible"
      287 |   await page.keyboard.press("Escape");
    > 288 |   await expect(page.locator(FLOW_MOUNT)).toBeHidden();
  1 failed
  8 passed (21.9s)
EXIT=1
```

Re-ran it in isolation 3× (all pass) and the full suite once more:

```
Running 9 tests using 1 worker
  ✓  1 … zero-config visit on the demo board (460ms)
  ✓  2 … collapse the invitation to a corner pill (494ms)
  ✓  3 … enter the one shell at beat 1 with the six-beat spine (481ms)
  ✓  4 … treat closing the flow as pausing — Esc returns to the board and re-entry resumes the saved beat (732ms)
  ✓  5 … never show the one-flow to a user who already finished setup (624ms)
  ✓  6 … show queued, running, and partial discovery outcomes (2.0s)
  ✓  7 … carry completed discovery into the pipeline and ready dossier materials (8.6s)
  ✓  8 SCRAPE-E2E-1: should show the scraped title and company for a real posting (1.1s)
  ✓  9 SCRAPE-E2E-1: should speak the structured 422 for a company jobs index url (1.0s)
  9 passed (16.1s)
EXIT=0
```

Both SCRAPE-E2E-1 tests pass on the integrated HEAD.

### `git diff --check` — clean

```
EXIT=0
```

### Canary status invocations — all documented exit codes reproduced

`--help` → exit **0**:
```
discovery-canary (read-only)
…
Exit codes: 0 healthy, 1 stale, 2 unavailable, 3 misconfigured, 4 internal error.
exit=0
```

`healthy` → exit **0** (fixture health server on :18644 serving `tests/mocks/health-response.ok.v1.json`):
```
$ npm run discovery:canary -- --max-age-hours 24 --worker-url http://127.0.0.1:18644 --state-dir <fresh fixtures>
discovery canary (read-only)
status: healthy
checked at: 2026-09-01T21:42:15.359Z
worker: http://127.0.0.1:18644 reachable=true http=200 discoveryWorker=true
newest successful run: run_fixture_fresh (completed) finished 2026-09-01T19:34:24.465Z, 2.13h ago (threshold 24h)
sheets: unavailable (sheets_credential_not_available)
reason: worker_healthy
reason: successful_run_fresh
exit code: 0
exit=0
```

`stale` → exit **1** (two shapes: run older than threshold, and no successful run at all):
```
status: stale … newest successful run: run_fixture_old (completed) finished 2026-08-28T16:34:24.465Z, 101.13h ago (threshold 24h)
reason: worker_healthy / reason: successful_run_stale / exit code: 1 / exit=1

status: stale … newest successful run: none within the readable run history (threshold 24h)
reason: worker_healthy / reason: no_successful_run / exit code: 1 / exit=1
```

`unavailable` → exit **2** (worker refuses; JSON form):
```
{
  "status": "unavailable",
  "reasons": [ "worker_unreachable", "run_state_unreadable" ],
  "exitCode": 2,
  "checkedAt": "2026-09-01T21:41:53.160Z",
  "maxAgeHours": 24,
  "worker": { "healthUrlOrigin": "http://127.0.0.1:59999", "reachable": false, "statusCode": 0, "isDiscoveryWorker": false },
  "run": null,
  "sheets": { "status": "unavailable", "reason": "sheets_credential_not_available" }
}
exit=2
```

`misconfigured` → exit **3** (both argument-error shapes):
```
$ npm run discovery:canary -- --bogus
status: misconfigured … reason: unknown_argument … exit code: 3 / exit=3

$ npm run discovery:canary -- --max-age-hours 0
status: misconfigured … reason: invalid_max_age_hours … exit code: 3 / exit=3
```

**Read-only proof (kickoff item 7 — "read the code path, not just the test").** I copied the
fixture state dir, hashed every file, ran the canary against it, and re-hashed:

```
=== read-only check: state dir unchanged? ===
IDENTICAL — canary mutated nothing (including the .tmp- orphan)
-rw-r--r--  cnVuX29ycGhhbg.json.tmp-1-2-3     ← crash leftover: still there
-rw-r--r--  cnVuX2JhZA.json                    ← malformed snapshot: still there, not repaired
-rw-r--r--  cnVuX2ZpeHR1cmVfZnJlc2g.json
```

The code path backs this up: `scripts/discovery-canary.mjs:29` imports `listRunStatusSnapshots`
(the additive LD-6 export), and `readRunHistoryFromDisk` at `:220-241` uses only
`existsSync`/`statSync`/`listRunStatusSnapshots`. `createDiscoveryRunStatusStore` — which sweeps
`.tmp-` files and rewrites corrupt snapshots at `run-status-store.ts:225-236` — is never referenced.
`listRunStatusSnapshots` itself (`run-status-store.ts:258-287`) is `readdirSync` + `readFileSync` +
`JSON.parse` + `isRunStatusSnapshot`, with `continue` on every failure. **No write syscall on the path.**

---

## Findings

### MAJOR-1 — the load-bearing "stop polling" branch has zero test coverage; deleting it restores the exact falsehood LD-4 forbids

`discovery-status-handoff.js:844-849`

```js
if (updated.status === "polling_error") {
  if (updated.statusEndpointTerminal) {
    renderDiscoveryRunStatus();
    return;
  }
  if (updated.pollErrorCount >= MAX_POLL_ERRORS) {
    tracker.markStatusConnectionLost(
      "Lost the status connection after multiple attempts. The discovery run may still be running.",
    );
```

`markStatusEndpointTerminal` (`discovery-run-tracker.js:430-434`) sets `pollErrorCount` to
`MAX_POLL_ERRORS`, so **without** the first branch the second one fires immediately and
`markStatusConnectionLost` (`discovery-run-tracker.js:408-420`) overwrites `errorMessage` — while
leaving `statusEndpointTerminal` true, so `renderDiscoveryRunStatus` (`:1077`) prints the overwritten
string through the terminal branch. The honest copy is replaced by the exact sentence LD-4 says must
never appear.

Nothing tests this. `grep -rn "statusEndpointTerminal" tests/` returns **5 hits, all in one file**
(`tests/discovery-lifecycle-poller.test.mjs:255,301,321,337,346`), and none of them drives
`startDiscoveryStatusPolling`. `tests/discovery-run-status-polling.test.mjs` only regex-matches the
function's source text. The render test at `:247` injects `statusEndpointTerminal: true` **together with an
already-honest `errorMessage`**, so it cannot observe the overwrite.

Mutation proof (`.lane-evidence/qa/qa-mutation-poller.probe.mjs`, deletes only those five lines in memory
and drives the real loop through the real tracker with a real 404 response):

```
--- HEAD (branch present) ---
pollsScheduledStillPending = 0
state.errorMessage = "The worker has no record of this run (HTTP 404). Status updates have stopped — check Runs or your sheet for the outcome."
toast = "Run run_abc1… — The worker has no record of this run (HTTP 404). Status updates have stopped — check Runs or your sheet for the outcome."
says 'may still be running' = false

--- MUTANT (branch deleted) ---
pollsScheduledStillPending = 0
state.errorMessage = "Lost the status connection after multiple attempts. The discovery run may still be running."
toast = "Run run_abc1… — Lost the status connection after multiple attempts. The discovery run may still be running."
says 'may still be running' = true
```

The implementation is **correct**; the coverage is hollow at the one place the claim actually lands.
`resumeDiscoveryStatusPollingIfNeeded`'s sibling early return (`:987-989`) is untested for the same reason.
Fix (Lane D's fence): one test that drives `startDiscoveryStatusPolling` with an injected `setTimeout`
queue against a 404 and asserts the rendered message never says "may still be running" — the probe above
is a working template.

### MAJOR-2 — the idempotency suite's stated motivation is a case the guard does not catch

`integrations/browser-use-discovery/tests/webhook/lifecycle-idempotency.test.ts:1-10` opens with:

> "the browser can abort AFTER the worker minted a runId and started a run; the user sees a network
> error and clicks 'Run discovery' again. At-least-once relays and manual+scheduled overlap produce
> the same shape."

But the derivation comment eleven hundred lines away in the production file
(`handle-discovery-webhook.ts:1364-1366`) states the opposite for that first case:
`requestedAt` "is stamped fresh per click at `discovery-payload.js:293`". I verified it — every
dispatch path stamps a new timestamp:

- `discovery-payload.js:293` — `var requestedAt = cleanString(input.requestedAt, 80) || new Date().toISOString();`
- `discovery-payload.js:372`, `:390` — same shape
- `discovery-wizard-verify.js:671` — `requestedAt: new Date().toISOString()`

A re-click therefore yields a different identity triple, a different derived runId, and **a second run** —
exactly the cost the header says is being prevented. What the guard genuinely catches is a
*byte-identical redelivery of the same payload*: an at-least-once relay/proxy retry, or a
manual+scheduled collision on an identical body. That is a real and worthwhile class, and the
mechanism is correct — but the test file's rationale will lead the next reader (and any operator
reading the lane report) to believe the double-click cost is solved when it is not.

This is a test-strength finding under kickoff item 2: the comment claims a business behavior the suite
does not encode and the code does not provide. Fix is a comment correction in Lane C's fence, or —
if the double-click case is in scope — a follow-up that carries a stable client-side idempotency key.

### MINOR-3 — a redelivery of a run that FAILED is acked `200 {ok:true, kind:"completed_sync"}`

`handle-discovery-webhook.ts:289-297`. `existing.terminal` is true for both success and failure, and
`DiscoveryWebhookAck` (`contracts.ts:1036-1044`) has `ok: true` as a literal with only two `kind`s — so
there is no failure shape to return. Reproduced (`.lane-evidence/qa/qa-lifecycle-failed-redelivery.probe.ts`,
real handler, `runDiscovery` throws):

```
FIRST  status: 500 body: {"ok":false,"message":"browser session crashed"}
SECOND status: 200 body: {
  "ok": true,
  "kind": "completed_sync",
  "runId": "run_b4fb332030a9ad3f686a2585793db631",
  "message": "Discovery failed — worker could not finish the run.",
  "outcome": { "status": "failed", "terminal": true, … "error": "browser session crashed" }
}
```

**Mitigated, not harmless.** `message` and `outcome.status` are honest, and the dashboard's
`isAsyncDiscoveryAcceptedResponse` (`discovery-wizard-verify.js:208-222`) accepts a 200-with-runId as
"accepted" and starts polling `/runs/:id`, which returns the failure — so the user-visible end state is
correct. But the same run answers 500/`ok:false` once and 200/`ok:true` the next time, and
**no test covers it**: `lifecycle-idempotency.test.ts` has 17 tests and none exercises a failed run
(`:312` covers only the `completed` terminal). One added case would pin whatever the program decides
the right answer is.

### MINOR-4 — the ASSET-1 stamper and its own guard share two blind spots, so a stale asset can ship silently

`scripts/assemble-index.mjs:47-50` — `tagAttribute` is `new RegExp(\`\\s${name}="([^"]*)"\`)`: **double
quotes only**. `stampableAssetUrl` (`:73-84`) only accepts `<link>` when `rel` contains `stylesheet`.
`verifySiteAssets` (`:126`) reuses *both*, so anything the stamper cannot see, the guard cannot flag either.
Probe (`.lane-evidence/qa/qa-asset1-parser.probe.mjs`) — three local scripts, all three then edited:

```
--- stamped output ---
<script src="a.js?v=5de4f905a7" defer></script>
<script src='b.js' defer></script>
<link rel="preload" as="script" href="favicon-shim.js">
--- after drifting ALL three files, problems reported ---
[ "a.js: index.html expects v=5de4f905a7 but the deployed file digests to v=0f4427cf8b" ]
```

Two of three drifted assets ship stale with the guard reporting success. **Not a BLOCKER: neither shape
exists today**, verified on the real `index.html`:

```
$ grep -nE "src='|href='" index.html partials/*.html      → (no output)
$ grep -oE '<link[^>]*rel="[^"]*"' index.html | grep -oE 'rel="[^"]*"' | sort | uniq -c
   2 rel="preload"
  35 rel="stylesheet"
```

and the 2 preloads are the `as="font"` pair LD-1's carve-out reasons about. The residual risk is that
the next person to add `<script src='x.js'>` or a `rel="preload" as="script"` gets no signal — the
deliberately-independent test scanner at `tests/pages-deploy-contract.test.mjs:60-73` carries the same
double-quote assumption, so it cannot catch it either. Cheapest fix: make `tagAttribute` accept both
quote styles, and have `verifySiteAssets` treat a *local* `preload`/`modulepreload` `as="script"|"style"`
href as in-scope (the font carve-out stays).

### MINOR-5 — `critical-journey.spec.mjs:265` flaked once under load

Pre-existing test, touched by no lane. Failed on my first full-suite run
(`#oneFlowMount` still visible 5s after `Escape`), then passed 3/3 in isolation and 1/1 on a second full
run. Raw output is under "Verification" above. Not a regression from this program — the diff for that
spec adds only the two SCRAPE-E2E-1 tests and splits `openDiscoveryAndRun` into
`openDiscoveryDrawer` + `openDiscoveryAndRun` — but it is a CI flake risk this branch will carry into
its PR, and worth knowing before someone reads a red run as a real failure.

### MINOR-6 — an argument-error canary report asserts facts it never checked

`scripts/discovery-canary.mjs:366-372`. `buildArgumentErrorReport` hard-codes
`health: { reachable: false, … }` and `runHistory: { available: false, reason: "run_state_unreadable" }`,
so a typo'd flag prints:

```
worker: (no usable worker url) reachable=false http=0 discoveryWorker=false
newest successful run: none within the readable run history (threshold 24h)
reason: unknown_argument
reason: worker_unreachable
reason: run_state_unreadable
```

Nothing was probed and no directory was read. The status and exit code are right; two of the three
reasons are fabricated. An operator debugging a real outage who fat-fingers a flag reads "worker
unreachable" and chases the wrong thing. Fix: when `configErrors` is non-empty, emit only those reasons.

### MINOR-7 — `docs/DISCOVERY-CANARY.md:66` lists a reason that can never appear in `reasons`

The reason-code table lists `sheets_credential_not_available` as claiming status `unavailable`. In the
code it is in `CANARY_REASONS` (`:55`) mapping to `"unavailable"`, but it is **never pushed into
`reasons`** — it only ever appears in the `sheets:` line (`:337-340`, `:360`). That is the correct
behavior (were it pushed, `STATUS_PRECEDENCE` would make the canary permanently `unavailable` and it
could never report `healthy`), but the doc says otherwise. Either drop that row from the reason table or
footnote it as report-only. The rest of the doc matches LD-7 exactly — exit codes 0/1/2/3/4, precedence
`misconfigured > unavailable > stale > healthy`, success set `{completed, partial, empty}`, `ingest_`
exclusion, "Sheets is never read".

### MINOR-8 — exit code 4 is documented but untested

`docs/DISCOVERY-CANARY.md:42` and `USAGE` (`scripts/discovery-canary.mjs:83`) both promise exit 4 for an
internal error. The `catch` that produces it (`:420-425`) sits inside the unexported `import.meta.url`
main guard, so none of the 20 `tests/discovery-canary.test.mjs` cases can reach it, and I could not
reproduce it from the CLI without injecting a fault. Documented-but-unreachable-by-test.

### MINOR-9 — the 4269-line webhook suite no longer exercises the derived-id path

`handle-discovery-webhook.test.ts:191,1169` add `runId: "run_queued"` to `runDependencies`. That is the
**highest-precedence** seam (`handle-discovery-webhook.ts:154-157`: `runDependencies.runId || derivedRunId || createRunId(...)`),
so across that whole suite `derivedRunId` is computed and then never equals `runId` — the dedupe
short-circuit at `:279` can never fire there. This is explicitly sanctioned by **LD-3(e)** and is the
minimal adjustment (the diff is `11 insertions, 0 deletions`; no assertion was touched), and it is
documented at the call site. Recording it so the program knows the regression surface for LIFECYCLE-1
now rests entirely on `lifecycle-idempotency.test.ts`.

### MINOR-10 — plain-language and a11y on the (now pinned) scrape 422 copy

Both are pre-existing product code that **LD-2 correctly forbade Lane B from editing**; flagging because
the new test now locks the copy in place with an exact-string assertion
(`critical-journey.spec.mjs:481-487`, `:559`).

1. `discovery-drawer.js:75-77` appends `Fallback: A job title and company were not supplied, so JobBored
   could not safely match an alternate result.` to the 422. For a user who pasted a company jobs index,
   that sentence explains an internal fallback they never asked for. The first three parts are excellent
   ("Choose a specific job posting first. Why: … Next: Open one role from that page and paste the role's
   direct URL. Details: wellfound.com."); the fourth is noise.
2. `discovery-drawer.js:1626-1627` sets `statusEl.textContent` **before** `setAttribute("role", "alert")`.
   The element is already a `role="status"` live region from "Fetching job listing…" (`:1594`), so the
   failure is first announced politely and only then becomes assertive. The new test asserts the final
   `role` is `alert` (`:553`), which is true — but the announcement the user actually hears is the polite one.

The **new** poller copy has no such problem: `"The worker has no record of this run (HTTP 404). Status
updates have stopped — check Runs or your sheet for the outcome."` — plain, no internal host, no stack,
names an action. Same for `"Your local worker is running, but mybox.tailnet-1234.ts.net is not reachable.
Check that the stable transport in front of it is up…"` (`discovery-status-handoff.js:292-296`).

### MINOR-11 — `classifyRunStatusPollResponse` retryable set is a superset of LD-4's

`discovery-status-handoff.js:528-534` returns `"retryable"` for **everything** that is neither 2xx nor in
`[401,403,404,405,410]` — so 400, 422, 501 also burn three retries. LD-4 enumerates retryable as
`0/408/425/429/500/502/503/504 + network errors` and enumerates terminal exhaustively; the terminal set
matches exactly, so this is compliant on the letter and a deliberate fail-open. Consequence is bounded
(three retries, then the honest "lost the status connection" copy). Recorded, no action needed.

### MINOR-12 — pre-existing duplicate line in `.gitignore`

`LANE-REPORT-*.md` appears at both `.gitignore:76` and `:80`. Present on the base; the integrator commit
`a7dcc4c` appended `index.assembled.html` below it without touching either. Cosmetic, not this program's.

---

## Cross-lane compatibility (kickoff item 3) — no conflicts found

| Interface | Producer | Consumer | Verdict |
|---|---|---|---|
| runId shape | LD-3 `deriveIdempotentRunId` → `run_` + 32 hex (`handle-discovery-webhook.ts:1381`) | previously `run_` + uuid-without-dashes = **also 32 hex** (`:1389`) | **identical shape**; nothing parses it. `renderDiscoveryRunStatus` slices to 8 (`discovery-status-handoff.js:1078`); the canary only prefix-matches `ingest_` (`discovery-canary.mjs:39,265`) |
| run status enum | `DiscoveryRunStatus = accepted \| running \| completed \| partial \| empty \| failed` (`contracts.ts:992-998`) | canary `SUCCESS_RUN_STATUSES = {completed, partial, empty}` (`discovery-canary.mjs:40`) | **exact match** with `DiscoveryLifecycleState` (`contracts.ts:854`). No success status missed. Abandoned runs are written as `"failed"` (`run-status-store.ts:236`), correctly not a success |
| terminal sets | LD-4 HTTP terminal `[401,403,404,405,410]` (`discovery-status-handoff.js:519`) vs snapshot `terminal: true` | different domains, no overlap to reconcile | no conflict |
| statusPath | LD-3 short-circuit returns the same `statusPath` it computed at `:165-173` from the same runId | poller accepts `statusPath` **and** `status_path` (`discovery-status-handoff.js:583`), now pinned by `tests/discovery-lifecycle.test.mjs:70-145` | **compatible**; the duplicate ack points the poller at the live run (`lifecycle-idempotency.test.ts:236-241`) |
| 422 fixture vs `toScrapeFailureResponse` | fixture body is **generated by** `toScrapeFailureResponse` (`scrape-job-fixtures.mjs:81`), never hand-typed | drawer's `formatScrapeFailure` (`discovery-drawer.js:38-78`) | **structurally impossible to drift** — the strongest coupling in the diff |
| digest stamp vs `src=` parsers | `--write` output only (LD-1) | `tests/hermetic-release-gate.test.mjs:130` compares `assembleIndex()` (unstamped); `tools/smoke-jb-v2.mjs:144` reads raw; `dev-server.mjs` serves unstamped; `boot-smoke.spec.mjs:102` walks the dev-served HTML | **no consumer sees a stamp**; all green in `npm test` and `test:e2e-smoke` |
| store method surface | LD-3 uses only `.get()` (`handle-discovery-webhook.ts:280`); LD-6 adds only a pure `listRunStatusSnapshots` | Lane C never touched `run-status-store.ts`; Lane E never touched the webhook | **no overlap**, exactly as LD-6 predicted |

One production-wiring check worth recording, because LD-3 is inert without it: `runStatusStore` **is**
passed at the live discovery-webhook call site (`integrations/browser-use-discovery/src/server.ts:1582`),
and `sharedRunDependencies` (`:293-309`) contains **no** `runId` key — so `derivedRunId` really is the
default in production, not just in tests. And the `get()`→`put()` window
(`handle-discovery-webhook.ts:280` → `:319`) contains **no `await`**, so two concurrent deliveries in one
Node process cannot both miss the check.

---

## Secrets and personal data (kickoff item 5) — clean

```
$ git diff 81e313a..HEAD | grep -nEi 'ya29|AIza|sk-[a-z0-9]|ngrok-free|ts\.net|@gmail|spreadsheets/d/'
```
Every hit is one of:
- **program documentation** quoting the scan pattern itself (GROUND-RULES, KICKOFF-qa, PROGRAM-SPEC, the five lane reports);
- **`mybox.tailnet-1234.ts.net`** — a pre-existing repo fixture, confirmed on the base:
  `git grep -c "mybox.tailnet-1234.ts.net" 81e313a -- tests/` → `tests/run-status-honesty.test.mjs:2`;
- **`abc123.ngrok-free.app`** — synthetic, new, obviously fake;
- **`ya29.fakeACCESStokenVALUE`** — deliberate redaction bait in `tests/discovery-canary.test.mjs:350`,
  asserted **absent** from both output forms at `:384-391`.

No `@gmail`, no `spreadsheets/d/`, no real Sheet ID (`grep -oE '\b1[A-Za-z0-9_-]{40,}\b'` returns only two
Playwright artifact directory names quoted inside a lane report). No `config.js` and no `.env` in the
changed-file list:

```
$ git diff 81e313a..HEAD --name-only | grep -Ei 'config\.js$|\.env'
(no output)
```

**Every new fixture read in full.** `tests/e2e-fixtures/job-posting-json-ld.html` is a synthetic JSON-LD
posting ("Platform Engineer at Acme", Remote). `tests/e2e-fixtures/scrape-job-fixtures.mjs` uses
`https://jobs.acme.test/...` and `https://wellfound.com/company/acme/jobs`; the latter is a **real public
host but is never fetched** — `captureScrapeFailure` injects `forbiddenFetch` (`:58-62,73`) which throws
if the scraper ever opens a socket, and the 422 is produced by `isKnownCompanyJobsIndex` before any
network call. `.lane-evidence/canary-fixtures/*` contain only `run_fixture_*` ids and `sheet_123`.

Ground-rules trap #4 holds: nothing in the diff reads `config.js`; the hermetic harness still serves
`config.example.js`.

---

## Determinism and hygiene (kickoff item 7) — clean

- **No wall-clock waits in race assertions.** `grep -nE 'setTimeout|sleep\(|waitForTimeout|delay\('`
  over every new/changed test returns only four hits, all of them `setTimeout` being *bound into a
  `vm` context* (`discovery-lifecycle.test.mjs:40`, `discovery-lifecycle-poller.test.mjs:71,118`,
  `discovery-stable-transport.test.mjs:45`). The one genuine race — a duplicate arriving while the
  original run is in flight — uses the explicit `deferred()` pattern
  (`lifecycle-idempotency.test.ts:73-81`, used at `:276-311`), and the diff of the two Playwright files
  contains no `waitForTimeout`.
- **No live network.** Every `https://` in the new tests is a string literal fed to a `vm`-mounted module
  or a mocked fetch: `mybox.tailnet-1234.ts.net` / `abc123.ngrok-free.app` /
  `jobbored-relay.example.workers.dev` (`discovery-stable-transport.test.mjs`),
  `accounts.google.com/gsi/client` (a stamping input, `pages-deploy-contract.test.mjs:169`),
  `wellfound.com` (never fetched, above). The e2e specs run behind `installHermeticNetworkFence` and
  every one asserts `fence.unexpectedExternal` is `[]`.
- **Temp dirs cleaned.** `withTempRoot` uses `try/finally` + `rmSync` (`pages-deploy-contract.test.mjs:75-82`);
  `discovery-canary.test.mjs:281,330` and `run-status-store.test.ts:545+` all use `try/finally` + `rm`.
- **The canary never mutates** — proven by hash comparison above *and* by reading the code path.

---

## Test strength (kickoff item 2)

I read every modified test. Summary of what each new suite encodes and whether an arbitrary
reimplementation survives it:

| Suite | Business behavior encoded | Survivable by a wrong implementation? |
|---|---|---|
| `pages-deploy-contract.test.mjs` (+10) | a changed file must change its URL; stamps are content-only (no clock/sha) so builds are reproducible; hand `?v=N` replaced not doubled; load order preserved; `assembleIndex()` stays unstamped; the guard catches drift, absence and unstamped refs | **No** — the scanner is deliberately re-implemented independently of the production parser (`:60-73`), `checked > 100` blocks a vacuous pass, and `exempt` is asserted to be *exactly* `["config.js"]`. Caveat: it inherits the double-quote assumption (MINOR-4) |
| `lifecycle-idempotency.test.ts` (+17) | one runId, one run, one DiscoveryRuns row, one Pipeline write across two identical deliveries; a live run returns the live status; distinct `requestedAt`/`variationKey`/`sheetId` each start fresh runs; auth and parse still reject before dedupe; no token echo | **No** — `randomId` returns `run_1`, `run_2`, so a single runId across two deliveries can only be the guard; the "guard must not swallow distinct runs" block (`:330-391`) blocks the degenerate always-dedupe implementation |
| `discovery-lifecycle.test.mjs` (+5) | the poller must accept both ack spellings or a hosted run is never polled at all; camelCase wins; a blank path falls through to synthesis | **No** — `:96-117` includes the control that a hosted ack with neither spelling yields `""` |
| `discovery-lifecycle-poller.test.mjs` (+14) | 401/403/404/405/410 never claim the run continues, and never burn a retry; transient codes still retry; older mounts still get honest copy | **Partly** — the classifier, `pollRunStatus` routing, render and tracker are all pinned, but the loop that consumes the flag is not (**MAJOR-1**) |
| `discovery-stable-transport.test.mjs` (+8) | a Tailscale box with a healthy worker is never told to fix ngrok and the ts.net host is named; a real ngrok user *still* gets the ngrok fix; a healthy worker is described as running | **No** — the ngrok control at `:151-171` blocks the lazy "never mention ngrok" fix, and the no-worker control at `:132-149` blocks the reverse |
| `discovery-canary.test.mjs` (+20) | every status/exit-code/precedence combination; the `/health` contract pinned to the shipped mock; `ingest_` and non-success runs excluded; **the state dir is byte-identical after a run**; the directory is never created; no token/sheetId/job title/error string reaches either output; every reason from the fixed enum | **No** — the read-only test hashes file contents before and after; the redaction test feeds five distinct secrets through both the health payload and the run history |
| `run-status-store.test.ts` (+3) | the read-only lister returns well-formed snapshots, skips truncated / wrong-schema / filename-mismatched / non-snapshot entries, leaves the directory byte-identical, and never creates a missing directory | **No** — byte-for-byte before/after comparison with a `.tmp-` leftover deliberately present |
| `critical-journey.spec.mjs` (+2) | the click issues exactly one real `POST /api/scrape-job` with the production `{url}` body; the success body reaches the user as spoken text; the 422 is announced `role=alert` with summary/Why/Next/host, each checked **against the server's own field**, and leaks nothing internal | **No** — the fixture bodies are generated by the production scraper module, so an invented response shape cannot pass, and `sent`/`statuses` prove the real request and the real 422 |

---

## Explicit statement on skipped or weakened tests (kickoff item 8)

**No test was skipped, filtered, disabled, or weakened in this diff.**

```
$ git diff 81e313a..HEAD | grep -cE '\.skip\(|\.only\(|todo\('
0
$ git diff 81e313a..HEAD | grep -nE '\.skip\(|\.only\(|todo\(|continue-on-error'
(only prose hits: GROUND-RULES/KICKOFF/PROGRAM-SPEC quoting the pattern, and one UI test title
 "renders one segment per beat with done/current/todo states" at npm-test.txt:2233)
```

Per-file deletion counts across every test and fixture file in the diff:

```
121  0  integrations/browser-use-discovery/tests/state/run-status-store.test.ts
 11  0  integrations/browser-use-discovery/tests/webhook/handle-discovery-webhook.test.ts
510  0  integrations/browser-use-discovery/tests/webhook/lifecycle-idempotency.test.ts
505  0  tests/discovery-canary.test.mjs
348  0  tests/discovery-lifecycle-poller.test.mjs
150  0  tests/discovery-lifecycle.test.mjs
311  0  tests/discovery-stable-transport.test.mjs
 29  0  tests/e2e-fixtures/hermetic-harness.mjs
 31  0  tests/e2e-fixtures/job-posting-json-ld.html
131  0  tests/e2e-fixtures/scrape-job-fixtures.mjs
134  1  tests/e2e-journey/critical-journey.spec.mjs
286  2  tests/pages-deploy-contract.test.mjs
```

**Three deleted lines in total**, none an assertion: `critical-journey.spec.mjs` -1 is the signature line
`async function openDiscoveryAndRun(page) {` being split into `openDiscoveryDrawer` +
`openDiscoveryAndRun`; `pages-deploy-contract.test.mjs` -2 are the two import lines widened to pull in the
new exports. **No assertion was deleted, loosened, or made conditional anywhere in the diff.**

One existing test file was *adjusted*: `handle-discovery-webhook.test.ts` (+11/-0) pins
`runDependencies.runId = "run_queued"` at two places. This is explicitly permitted by **LD-3(e)**, is the
minimal form (it uses an existing seam rather than editing assertions), and is documented at both call
sites. Its coverage consequence is recorded as MINOR-9.

The one non-passing entry in `npm test` is a **pre-existing `todo`** on the base
(`tests/submission-record-audit.test.mjs:18`, "blocked on the canonical-ownership gate"), unchanged by this
program; `fail 0`, `skipped 0`, exit 0.

---

## Commit, risks, and handoff

**No commit. Read-only lane — commit SHA: none, by design.** Reviewed HEAD is `a116683`.
Nothing staged, nothing committed, nothing pushed, no remote, no PR. `git status --porcelain` is empty
(this report and `.lane-evidence/` are gitignored).

### Adjudication recommendation

Merge-ready with two follow-ups. Both MAJORs are **coverage and narrative**, not behavior — every claim's
production code does what its locked decision says, verified by running it, not by reading it:

- **ASSET-1** — the guard genuinely fails a drifted `_site` (Lane A's end-to-end evidence reproduced by
  `verifySiteAssets` in my own probe), and the workflow orders build → verify → upload (`pages.yml:29-54`).
- **SCRAPE-E2E-1** — both tests green on the integrated HEAD; the fixture is generated by the production
  scraper, so success and 422 cannot drift apart.
- **LIFECYCLE-1** — the guard is wired in production (`server.ts:1582`), has no intra-process race, and is
  proven exactly-once on runs, rows and Pipeline writes. Scope caveat at MAJOR-2.
- **STABLE-1** — the single locked gap is closed, both controls hold, and `run-status-honesty.test.mjs`
  stayed untouched and green.
- **CANARY-1** — all four statuses and exit codes reproduced by me, and the read-only property proved by
  hashing rather than trusting the test.

Ranked for the orchestrator:

1. **MAJOR-1** (Lane D fence) — add one test that drives `startDiscoveryStatusPolling` against a 404.
   Cheap; `.lane-evidence/qa/qa-mutation-poller.probe.mjs` is a working harness. Do this before merge:
   the branch it protects is the whole of LD-4's user-facing promise.
2. **MAJOR-2** (Lane C fence) — correct the comment at `lifecycle-idempotency.test.ts:1-10`, or decide the
   double-click case is in scope and schedule a client-side idempotency key. Comment fix is minutes.
3. **MINOR-3, 6, 7, 8** — small, each one file, each in a closed lane's fence.
4. **MINOR-4** — worth a follow-up lane; not urgent, since no offending shape exists in `index.html` today.
5. **MINOR-5** — watch `critical-journey.spec.mjs:265` in CI; if it flakes again, it needs its own fix
   independent of this program.
6. **MINOR-9, 10, 11, 12** — record only.

### Things outside my fence

Everything, by definition — this lane fixes nothing. All twelve findings are handed to the orchestrator
with file:line evidence and the owning lane named. The three scratch probes in `.lane-evidence/qa/` are
reusable as-is by whoever picks up MAJOR-1, MINOR-3 or MINOR-4.

### Model / vehicle

Reviewed by Opus 5 (`claude-opus-5`), high effort. No sub-agents were spawned; all work in-lane.
