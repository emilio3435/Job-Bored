# Lane report: repair-lifecycle

Repair lane C — QA **MAJOR-2** and **MINOR-3** against LIFECYCLE-1.
Worktree `/private/tmp/Job-Bored-discovery-hardening-lifecycle`, branch `feat/discovery-hardening-lifecycle`.
Base HEAD `88e156b` (predecessor's commit) → my commit `64490f2`.

## Scope and ownership

Fence (unchanged from Lane C), and I stayed inside it:

- `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts` — comment only
- `integrations/browser-use-discovery/tests/webhook/lifecycle-idempotency.test.ts`
- `tests/discovery-lifecycle.test.mjs` — inspected, needed no change (it characterizes the
  snake_case `status_path` tolerance and carries no claim about deduping a re-click)

```
$ git diff 88e156b..HEAD --stat
 .../src/webhook/handle-discovery-webhook.ts        |  10 +-
 .../tests/webhook/lifecycle-idempotency.test.ts    | 150 ++++++++++++++++++++-
 2 files changed, 151 insertions(+), 9 deletions(-)
```

**No behavior change.** The only production edit is a doc comment on
`deriveIdempotentRunId`. The ack contract (LD-3) is untouched — `DiscoveryWebhookAck`
in `contracts.ts` was not opened.

Scratch (all gitignored, under `.lane-evidence/repair/`): the two RED probes, a row-shape
probe, and the raw gate/floor logs.

## Baseline and RED evidence

### Baseline — the suite this lane repairs was green before I touched it

```
$ npm run test:browser-use-discovery
ℹ tests 744
ℹ suites 2
ℹ pass 744
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2878.255958
```

### RED for MAJOR-2 — the header's stated motivation is a case the guard does not catch

`.lane-evidence/repair/red-major2-reclick.probe.ts` drives the **real** dashboard payload
builder (`discovery-payload.js`, required through its UMD wrapper) and the **real**
`handleDiscoveryWebhook`. Two clicks of "Run discovery" with identical user input —
only the clock moved:

```
$ node --experimental-strip-types .lane-evidence/repair/red-major2-reclick.probe.ts
click A requestedAt: 2026-09-01T21:58:25.555Z variationKey: manual-20260901-7e8495df
click B requestedAt: 2026-09-01T21:58:25.561Z variationKey: manual-20260901-10918ecf
identical payload bodies?  false
first  runId: run_ec95bfcc8c0cf23a85012eedfce25bd9
second runId: run_d8c7b4c475ef749f928b77e63ffd5400
runs actually dispatched: 2 [
  'run_ec95bfcc8c0cf23a85012eedfce25bd9',
  'run_d8c7b4c475ef749f928b77e63ffd5400'
]
DiscoveryRuns rows appended: 2
```

Two runs, two history rows — exactly the cost the old header (lines 1-10) claimed the guard
prevented. Note the re-click differs in **two** identity fields, not one:
`generateVariationKey` (`discovery-payload.js:371-386`) hashes `requestedAt`, so the
variation key rotates with it. Confirmed every dispatch path stamps a fresh timestamp:

```
discovery-readiness.js:685   const requestedAt = new Date().toISOString();      (dashboard "Run discovery")
discovery-payload.js:293     var requestedAt = cleanString(input.requestedAt, 80) || new Date().toISOString();
discovery-payload.js:372     var requestedAt = cleanString(input && input.requestedAt, 80) || new Date().toISOString();
discovery-payload.js:390     var requestedAt = cleanString(source.requestedAt, 80) || new Date().toISOString();
discovery-wizard-verify.js:671            requestedAt: new Date().toISOString(),
```

### RED for MINOR-3 — the failed-run redelivery had zero coverage

```
$ grep -rn "failed\|throw new Error" integrations/browser-use-discovery/tests/webhook/lifecycle-idempotency.test.ts
(no match — no failed-run coverage)

$ node --experimental-strip-types .lane-evidence/qa/qa-lifecycle-failed-redelivery.probe.ts
FIRST  status: 500 body: {"ok":false,"message":"browser session crashed"}
SECOND status: 200 body: {
  "ok": true,
  "kind": "completed_sync",
  "runId": "run_b4fb332030a9ad3f686a2585793db631",
  "message": "Discovery failed — worker could not finish the run.",
  "statusPath": "/runs/run_b4fb332030a9ad3f686a2585793db631",
  "outcome": {
    "runId": "run_b4fb332030a9ad3f686a2585793db631",
    "status": "failed",
    "terminal": true,
    ...
    "error": "browser session crashed"
  }
}
```

The new test was written to that shape **before** it passed, and its first run was genuinely
RED — my initial assumption (that a failed run writes no DiscoveryRuns row) was wrong:

```
✖ LIFECYCLE-1: a redelivery of a failed run replays its terminal outcome as completed_sync (contract has no failed-ack kind — see QA MINOR-3) (0.60225ms)
  AssertionError [ERR_ASSERTION]: the failed run wrote no DiscoveryRuns row, and the redelivery must not add one
  1 !== 0
```

`.lane-evidence/repair/failed-row-shape.probe.ts` established the truth — the terminal history
finalizer writes exactly one row, `status: "failure"`, `error: "browser session crashed"`, and the
redelivery adds none — and the assertion now pins that instead.

## Implementation

1. **Header rewrite** (`lifecycle-idempotency.test.ts:1-30`). Split into *WHAT THE GUARD
   CATCHES* (a byte-identical redelivery: an at-least-once relay/proxy/tunnel retry, a
   manual+scheduled collision on an identical body, any client retrying the request it already
   built) and *WHAT IT DOES NOT CATCH* — a user re-click, with the five wall-clock stamp sites
   and the `generateVariationKey` rotation named, and the exit named too (a client-supplied
   idempotency key, which `DiscoveryWebhookRequestV1` does not carry).
2. **New test — `LIFECYCLE-1: a user re-click is NOT deduped …`**. Two POSTs differing only in
   `requestedAt` → two runIds, two dispatched runs, two DiscoveryRuns rows, two pipeline writes.
   The doubled cost is asserted, not described.
3. **New test — `LIFECYCLE-1: a redelivery of a failed run replays its terminal outcome as
   completed_sync (contract has no failed-ack kind — see QA MINOR-3)`**. First delivery 500
   `{ok:false}`; redelivery 200 `{ok:true, kind:"completed_sync"}`, same runId, same statusPath,
   `outcome.status:"failed"`, `outcome.error` intact, one run, one `status:"failure"` history row.
   Harness gained one option (`failWith`) so `runDiscovery` can throw.
4. **Production comment** (`handle-discovery-webhook.ts:1363-1377`). The old note cited only
   `discovery-payload.js:293`; it now cites all five stamp sites and says outright that a
   second click is deliberately *not* covered and why. No code changed.

### Mutation checks — the two new tests are not hollow

```
--- MUTATION A: drop requestedAt from the identity triple ---
✖ LIFECYCLE-1: a different requestedAt starts a fresh run (0.366416ms)
✖ LIFECYCLE-1: a user re-click is NOT deduped — a fresh requestedAt starts a second run, second row, second bill (0.170083ms)
✖ LIFECYCLE-1: deriveIdempotentRunId separates every identity field (0.182625ms)
ℹ tests 19
ℹ pass 16
ℹ fail 3
  AssertionError [ERR_ASSERTION]: a re-click derives a different runId — the guard cannot see it as a duplicate

--- MUTATION B: treat a failed terminal run as non-terminal in the dedupe branch ---
✖ LIFECYCLE-1: a redelivery of a failed run replays its terminal outcome as completed_sync (contract has no failed-ack kind — see QA MINOR-3) (0.967375ms)
ℹ tests 19
ℹ pass 18
ℹ fail 1
  AssertionError [ERR_ASSERTION]: the redelivery is answered from the store, not re-run
```

Both mutations were reverted from a pre-mutation copy; `git diff --stat` after the revert showed
only the intended comment + test changes.

## Verification and raw output

### GREEN — the repaired suite

```
$ node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/lifecycle-idempotency.test.ts
✔ LIFECYCLE-1: a duplicate delivery resolves to the original runId and starts no second run
✔ LIFECYCLE-1: a duplicate delivery writes exactly one DiscoveryRuns row
✔ LIFECYCLE-1: a duplicate delivery performs exactly one Pipeline write
✔ LIFECYCLE-1: a duplicate arriving while the original run is still in flight returns the live run
✔ LIFECYCLE-1: a duplicate of a finished run returns its terminal outcome, not a new run
✔ LIFECYCLE-1: a redelivery of a failed run replays its terminal outcome as completed_sync (contract has no failed-ack kind — see QA MINOR-3)
✔ LIFECYCLE-1: a different requestedAt starts a fresh run
✔ LIFECYCLE-1: a user re-click is NOT deduped — a fresh requestedAt starts a second run, second row, second bill
✔ LIFECYCLE-1: a different variationKey starts a fresh run
✔ LIFECYCLE-1: a different sheetId starts a fresh run
✔ LIFECYCLE-1: without a run-status store the runId stays random, so nothing collapses
✔ LIFECYCLE-1: a redelivery with a bad secret is still rejected 401 before any dedupe
✔ LIFECYCLE-1: an unparseable redelivery is still rejected 400 before any dedupe
✔ LIFECYCLE-1: an invalid requestedAt is rejected at parse, so it can never collapse runs
✔ LIFECYCLE-1: a duplicate ack never echoes the per-request googleAccessToken
✔ LIFECYCLE-1: deriveIdempotentRunId is deterministic for one request identity
✔ LIFECYCLE-1: deriveIdempotentRunId separates every identity field
✔ LIFECYCLE-1: deriveIdempotentRunId cannot be forged by moving a field boundary
✔ LIFECYCLE-1: deriveIdempotentRunId returns null without a usable requestedAt
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 121.874042
```

(17 → 19: the two added tests. Single-file form used only for the mutation checks; the gate
below is the real run.)

### Lane gate

```
$ npm run test:browser-use-discovery
ℹ tests 746
ℹ suites 2
ℹ pass 746
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2150.323667

$ npm run typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json
(exit 0)

$ npm run test:contract:all
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md
```

### Repository floor (re-run from this worktree AFTER the commit)

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
ℹ tests 2489     (root node:test suites)
ℹ pass 2488
ℹ fail 0
ℹ skipped 0
ℹ todo 1
ℹ tests 746      (browser-use-discovery)
ℹ pass 746
ℹ fail 0
ℹ skipped 0
ℹ todo 0
exit=0

$ npm test        # the real gate — run-tests.mjs, includes tests/integration/
ℹ tests 2520
ℹ pass 2519
ℹ fail 0
ℹ skipped 0
ℹ todo 1
exit=0

$ git diff --check
exit=0
```

The single `todo` is pre-existing and untouched by this lane:
`✖ persists and can remove the canonical submission evidence record # blocked on the
canonical-ownership gate; no legal Sheet column or IndexedDB store`
(`tests/submission-record-audit.test.mjs:78`) — a `todo`-marked test, counted in `todo 1` with
`fail 0`, present on the baseline `88e156b` too.

## Commit, risks, and handoff

**Commit: `64490f2`** — `test(discovery-hardening/lifecycle): pin what LD-3 does and does not dedupe`.
One coherent local commit on top of `88e156b`. Nothing pushed, no PR, no remote touched.

Secret scan of the diff before committing (`ya29.`, `AIza`, `sk-`, `ngrok`, long tokens,
hostnames, Sheet IDs, `.env`): no matches — the only hits on the long-token pattern were comment
rule lines (`// ------`). All identifiers in the tests are the suite's fixtures
(`sheet_lifecycle`, `var_lifecycle`, `lifecycle-secret-abc123`, `oauth-proof-lifecycle`).

### Risks

- **The MAJOR-2 limitation is now documented and pinned, not fixed.** A user who double-clicks
  still pays for two runs. Closing it needs a client-supplied idempotency key on
  `DiscoveryWebhookRequestV1` — a contract change, out of this lane's fence and out of LD-3.
  If the program decides to close it, `"a user re-click is NOT deduped"` is the test that must
  be rewritten, and the header says so.
- **MINOR-3 is pinned as-is, ack contract unchanged.** A failed run answers 500 `{ok:false}`
  once and 200 `{ok:true, kind:"completed_sync"}` on redelivery. The body stays honest
  (`outcome.status:"failed"`), and `isAsyncDiscoveryAcceptedResponse`
  (`discovery-wizard-verify.js:208-222`) accepts the 200 and polls `/runs/:id`, so the
  user-visible end state is correct. If the contract later grows a failure kind, that test is
  the one that goes red — deliberately.

### Handoff — needed outside my fence

- `docs/programs/discovery-hardening/SCOUT-worker.md:58` still lists "user re-click after abort"
  among the duplicate-delivery sources LIFECYCLE-1 addresses. The mechanism it describes (the
  15s abort) is real, but the re-click is **not** deduped, as this lane now proves. The scout
  doc is orchestrator-owned; one sentence there should be corrected to match the test header,
  or the next reader inherits the same wrong impression the QA review caught.
- No other change was needed outside the fence. `tests/discovery-lifecycle.test.mjs` was read
  and left alone; nothing in it repeats the false claim.

### Model / vehicle

Ran as Opus 5 (`claude-opus-5`), high effort. No sub-agents spawned; all work in-lane.
Nothing pushed, no remotes, no secrets, no schedules or infrastructure touched.
