# Lane report: repair-stable-transport

Repair lane D — **MAJOR-1** from the integrated QA review (`.lane-evidence/qa-report.md` §MAJOR-1).
Fresh lane on `feat/discovery-hardening-stable-transport`, base HEAD `dfbad73` (predecessor's commit).
Worktree `/private/tmp/Job-Bored-discovery-hardening-stable-transport`.

## Scope and ownership

**Test-only.** One file changed: `tests/discovery-lifecycle-poller.test.mjs` (+224, -0).

```
$ git diff --stat
 tests/discovery-lifecycle-poller.test.mjs | 224 ++++++++++++++++++++++++++++++
 1 file changed, 224 insertions(+)
```

Fence (Lane D): `discovery-status-handoff.js`, `discovery-run-tracker.js`,
`tests/discovery-lifecycle-poller.test.mjs`, `tests/discovery-stable-transport.test.mjs`. I touched one of
the four; the two production files are byte-identical to `dfbad73` (they were mutated in place for the
proof below and restored — checksum verified, see "Baseline and RED evidence").

**No production change was needed.** QA's finding was explicit that "the implementation is **correct**;
the coverage is hollow at the one place the claim actually lands." The mutation runs below confirm that
from both directions: with the branches present the honest copy survives, with either deleted the LD-4
falsehood returns. Adding production code here would have been change without a failing case.

Secret scan of the diff (`ya29.`, `AIza`, `sk-`, `ngrok`, hostnames, Sheet IDs, `.env`) — clean; the only
hits were the loopback fixture URL `http://127.0.0.1:8644/webhook` and long identifier names.

## Baseline and RED evidence

### Baseline — the gate before any change (on `dfbad73`, clean tree)

```
$ git status --porcelain
(empty)
$ npm test -- tests/discovery-lifecycle-poller.test.mjs tests/discovery-stable-transport.test.mjs tests/run-status-honesty.test.mjs tests/discovery-run-status-polling.test.mjs
ℹ tests 60
ℹ suites 12
ℹ pass 60
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 74.638458
EXIT=0
```

Green — which is exactly the hole. The RED for a coverage repair is not a failing gate, it is the
**mutation**: with the new tests in place, deleting either load-bearing branch must turn them red.
Both mutations were applied to the real `discovery-status-handoff.js` (backed up to
`.lane-evidence/discovery-status-handoff.js.orig`, restored and checksum-verified after each).

### RED — mutation M1: delete the loop early return (`startDiscoveryStatusPolling`, `:844-849`)

```js
      if (updated.statusEndpointTerminal) {
        // Settled: the message is already honest, and another poll would
        // only re-earn the same answer.
        renderDiscoveryRunStatus();
        return;
      }
```

```
$ npm test -- tests/discovery-lifecycle-poller.test.mjs
ℹ tests 20
ℹ pass 17
ℹ fail 3

✖ failing tests:

test at tests/discovery-lifecycle-poller.test.mjs:441:3
✖ LIFECYCLE-1: a 404 settles the loop — one attempt, no further poll, and never 'may still be running'
  AssertionError [ERR_ASSERTION]: the loop must leave the honest terminal copy in place, not overwrite it with the connection-lost copy
    actual: 'Lost the status connection after multiple attempts. The discovery run may still be running.',
    expected: /no record of this run \(HTTP 404\)/,
    operator: 'match',

test at tests/discovery-lifecycle-poller.test.mjs:487:3
✖ LIFECYCLE-1: a 401 settles the loop and keeps the status-token reason
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /status token \(HTTP 401\)/i. Input:

  'Lost the status connection after multiple attempts. The discovery run may still be running.'

    actual: 'Lost the status connection after multiple attempts. The discovery run may still be running.',
    expected: /status token \(HTTP 401\)/i,
    operator: 'match',

test at tests/discovery-lifecycle-poller.test.mjs:534:3
✖ LIFECYCLE-1: resumeDiscoveryStatusPollingIfNeeded does not restart polling after a 404
  AssertionError [ERR_ASSERTION]: The input was expected to not match the regular expression /may still be running/i. Input:

  'Run run_abc1… — Lost the status connection after multiple attempts. The discovery run may still be running.'

    actual: 'Run run_abc1… — Lost the status connection after multiple attempts. The discovery run may still be running.',
    expected: /may still be running/i,
    operator: 'doesNotMatch',
EXIT=1
```

That is QA's mutant reproduced, now with a test standing in front of it. Full log:
`.lane-evidence/mutation-M1-red.log`.

### RED — mutation M2: delete the sibling early return (`resumeDiscoveryStatusPollingIfNeeded`, `:987-989`)

```js
  // A settled status endpoint stays settled across a reload — re-polling it
  // would only re-earn the same 404/401.
  if (next.statusEndpointTerminal) return;
```

```
$ npm test -- tests/discovery-lifecycle-poller.test.mjs
ℹ tests 20
ℹ pass 19
ℹ fail 1

✖ failing tests:

test at tests/discovery-lifecycle-poller.test.mjs:534:3
✖ LIFECYCLE-1: resumeDiscoveryStatusPollingIfNeeded does not restart polling after a 404
  AssertionError [ERR_ASSERTION]: a reload must not re-poll a status endpoint that already gave a settled answer

  1 !== 0

    actual: 1,
    expected: 0,
    operator: 'strictEqual',
EXIT=1
```

Full log: `.lane-evidence/mutation-M2-red.log`.

### Restore verified byte-identical after both mutations

```
$ shasum -a 256 discovery-status-handoff.js
b4fc6f6d88fd351bd6d959aa839ad664ebe7632c5494b31566cbf4074a154b28  discovery-status-handoff.js
$ cp .lane-evidence/discovery-status-handoff.js.orig discovery-status-handoff.js
$ shasum -a 256 -c .lane-evidence/handoff.sha256
discovery-status-handoff.js: OK
$ git status --porcelain
 M tests/discovery-lifecycle-poller.test.mjs
```

Only the test file is modified. `discovery-status-handoff.js` and `discovery-run-tracker.js` are unchanged.

## Implementation

Tests only, appended to `tests/discovery-lifecycle-poller.test.mjs`.

**`loadRealLoop()` — a new harness in the file's existing vm-mount style.** The file already had two
mounts: `loadStatus()` (real handoff over a *recording fake* tracker) and `loadRealTracker()` (real
tracker over an in-memory localStorage). Neither can see the loop: a fake tracker's `getState()` never
reflects what `markStatusConnectionLost` did, so the overwrite QA found is invisible. `loadRealLoop()`
mounts the real `discovery-status-handoff.js` over the real `DiscoveryRunTracker`, wires the real
`window.JobBoredDiscovery.status.host`, and injects `setTimeout` as a **queue** rather than a clock —
`{ fn, delay }` pushed to an array, stepped by an async `drain()` (ground-rules trap #8: no wall-clock
sleep in a race assertion). It lifts the QA probe's mount rather than reinventing it, and additionally
counts `fetch` calls so retry-budget claims are checkable.

Five `LIFECYCLE-1:` tests across two suites:

| Test | Asserts |
|---|---|
| 404 settles the loop | exactly one first poll scheduled; after drain **zero** further polls; `fetches.length === 1` (no retry burned); `statusEndpointTerminal === true`; `errorMessage` matches `/no record of this run \(HTTP 404\)/`; **every** toast fails `/may still be running/i`; last toast matches `/no record of this run/i` and is sticky |
| 401 settles the loop | same shape; `errorMessage` matches `/status token \(HTTP 401\)/i`; no toast says "may still be running" |
| 503 keeps the retryable path | `fetches.length === MAX_POLL_ERRORS`; `statusEndpointTerminal === false`; `errorMessage` **does** say "may still be running" |
| resume after 404 | `resumeDiscoveryStatusPollingIfNeeded()` schedules nothing and issues no new fetch; no toast says "may still be running" |
| resume after 503 | `resumeDiscoveryStatusPollingIfNeeded()` **does** schedule one poll |

The last two are a matched pair on purpose. Without the 503 half, "resume scheduled nothing" would also
pass against a `resumeDiscoveryStatusPollingIfNeeded` that simply never polls — the contrast is what makes
the 404 assertion carry the terminal marker rather than a tautology. The 503 test plays the same role for
the loop: it pins that the *retryable* path still says "may still be running", so the 404/401 assertions
are testing classification, not a blanket ban on the string.

Two module-level constants were added for the harness: `WEBHOOK_URL` (the loopback fixture already used
throughout the file) and `MAX_POLL_ERRORS = 3`, commented as mirroring `discovery-status-handoff.js:512`.

## Verification and raw output

### Lane gate — GREEN

```
$ npm test -- tests/discovery-lifecycle-poller.test.mjs tests/discovery-stable-transport.test.mjs tests/run-status-honesty.test.mjs tests/discovery-run-status-polling.test.mjs

▶ LIFECYCLE-1 — the real poll loop stops at a settled status endpoint
  ✔ LIFECYCLE-1: a 404 settles the loop — one attempt, no further poll, and never 'may still be running' (1.350083ms)
  ✔ LIFECYCLE-1: a 401 settles the loop and keeps the status-token reason (0.916084ms)
  ✔ LIFECYCLE-1: a retryable 503 still exhausts its retries and keeps the connection-lost copy (0.748417ms)
✔ LIFECYCLE-1 — the real poll loop stops at a settled status endpoint (3.143166ms)
▶ LIFECYCLE-1 — a settled status endpoint stays settled across a reload
  ✔ LIFECYCLE-1: resumeDiscoveryStatusPollingIfNeeded does not restart polling after a 404 (0.624625ms)
  ✔ LIFECYCLE-1: resumeDiscoveryStatusPollingIfNeeded DOES restart polling after a retryable loss (1.181875ms)
✔ LIFECYCLE-1 — a settled status endpoint stays settled across a reload (1.849875ms)

ℹ tests 65
ℹ suites 14
ℹ pass 65
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 84.040875
EXIT=0
```

Gate baseline was 60 tests; now 65. Net **+5, none lost**.

### Repository floor — all GREEN

```
$ npm run typecheck:repo
> command-center@0.1.0 typecheck:repo
> npm run typecheck:browser-use-discovery && node --check app.js && … && node --check discovery-status-handoff.js && node --check discovery-run-tracker.js && … && npm run typecheck:server

> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

typecheck:repo EXIT=0
```

```
$ npm run lint:repo
> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md

lint:repo EXIT=0
```

```
$ npm run test:repo
ℹ tests 2512
ℹ suites 596
ℹ pass 2511
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6252.972

ℹ tests 727
ℹ suites 2
ℹ pass 727
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2535.551583

test:repo EXIT=0
```

```
$ npm test          # the real CI gate — ground-rules trap #1
ℹ tests 2543
ℹ suites 605
ℹ pass 2542
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6507.661166

npm test EXIT=0
```

The single `todo` is the pre-existing `tests/submission-record-audit.test.mjs` one QA already traced to
base `81e313a`. Nothing skipped, nothing filtered.

```
$ git diff --check
git diff --check EXIT=0
```

Exit codes captured verbatim in `.lane-evidence/floor-exit.log`; full logs in `.lane-evidence/floor.log`,
`.lane-evidence/gate-green.log`, `.lane-evidence/baseline-gate.log`.

## Commit, risks, and handoff

**Commit:** `0d595b2` — `test(discovery-hardening/stable-transport): cover the settled-status early returns the mutation exposed`

Local only. Nothing pushed, no PR, no remote touched.

### Risks

- **Harness coupling to source text.** `loadRealLoop` mounts `discovery-status-handoff.js` by `vm` and
  supplies a hand-written `host`. If the module grows a new required `host` method on the polling path,
  this harness fails loudly with a TypeError rather than silently — acceptable, and the same exposure the
  file's two existing mounts already carry.
- **`MAX_POLL_ERRORS` is duplicated** in the test (3) rather than read from the module, which does not
  export it. If the production constant changes, the 503 test's `fetches.length` assertion fails loudly
  and points at the comment naming `discovery-status-handoff.js:512`. Fail-loud beats a regex-scraped
  constant.
- **Not covered:** the `markStatusEndpointTerminal`-absent fallback path (older mounts) through the *loop*
  — the existing fake-tracker test covers it at the `pollRunStatus` level, and the loop reads only
  `state.statusEndpointTerminal`, which `markStatusConnectionLost` never sets. No coverage hole of the
  MAJOR-1 kind remains there.

### Handoff

- **Nothing outside the fence was needed.** No file outside Lane D's four was edited, and no `package.json`
  or docs change is requested from the orchestrator.
- **QA MAJOR-1 is closed.** The two branches QA proved load-bearing-but-untested are now each pinned by a
  test that goes red when the branch is deleted (M1: 3 red, M2: 1 red), and green when it is present.
- **QA MAJOR-2** (`lifecycle-idempotency.test.ts`'s overstated rationale) is Lane C's fence, untouched here.
- `docs/programs/discovery-hardening/reports/stable-transport.md` is orchestrator-owned; this report is the
  lane's artifact and can be copied there by the integrator.
