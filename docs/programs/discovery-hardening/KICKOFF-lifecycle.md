# Lane C — lifecycle · discovery lifecycle and idempotency (claim LIFECYCLE-1)

Read `GROUND-RULES.md` and `PROGRAM-SPEC.md` (Locked decisions win). Worktree: `/private/tmp/Job-Bored-discovery-hardening-lifecycle`, branch `feat/discovery-hardening-lifecycle`.

**Goal:** Prove the browser/worker lifecycle contract, retry classification, and exactly-once effects under duplicate or delayed delivery, with deterministic tests.

**Success means:**
- `LIFECYCLE-1:`-prefixed tests cover every row of the matrix in the locked spec: accepted, running, retryable polling (both `statusPath` and `status_path`), terminal completed, terminal failed, duplicate webhook delivery for the same run, exactly-once DiscoveryRuns row, exactly-once Pipeline write.
- Tests use `deferred()`-style controls or injected dependencies; NO `setTimeout`/sleep in race assertions.
- Production changes ONLY in the files the locked spec names, and ONLY where a RED proves existing behavior wrong (e.g. duplicate delivery starts a second run). Retry classification is a pure function — no model call decides routing/retry/idempotency.
- The webhook order invariant is preserved: method check → secret auth → JSON parse → per-run `googleAccessToken` strip → preflight → first run-status side effect → run. Error details that feed the discovery UX survive; secrets stay redacted.

**Fence (exclusive, per spec LD-3/LD-4/LD-8):** tests under `integrations/browser-use-discovery/tests/webhook/`, `tests/sheets/`, `tests/state/` (existing files only — do NOT edit `src/state/run-status-store.ts`, Lane E owns it); root `tests/discovery-lifecycle.test.mjs` (new, characterization only). Production: ONLY `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts`, and `src/server.ts` `sharedRunDependencies` (~292–308) solely to wire the behavior on. `discovery-status-handoff.js` / `discovery-run-tracker.js` are Lane D's — the poll retry classification (404/401 terminal) is Lane D's unit (ii); you do NOT implement it and you do NOT write tests that need it.

**Your matrix (from `SCOUT-worker.md` §LIFECYCLE-1(c)):** rows 1–12 already have proving tests — cite them in your report, do not duplicate. Rows 14–17 are yours:
- Row 14 `status_path`: lift the scout's two green characterization cases (camelCase + snake_case from an `accepted_async` ack) into `tests/discovery-lifecycle.test.mjs` using the vm-mount harness from `tests/run-status-honesty.test.mjs:67–117`. No production change.
- Rows 15/16/17 duplicate delivery: implement LD-3. Identity = `sheetId + variationKey + requestedAt` (sha256, e.g. `run_<hex32>`); derive ONLY when `requestedAt` is a valid timestamp AND `runStatusStore` is present, else keep `createRunId(randomId)`. After preflight: `existing = runStatusStore.get(derivedRunId)`; if present, return the original ack (same runId + statusPath; 202 with the current status) and do NOT call `runDiscovery`, do NOT create a second finalizer. Assert in tests: `runDiscoveryCalls === 1`, `discoveryRunsAppends === 1`, both acks carry the same runId/statusPath, and a DIFFERENT `requestedAt` still starts a fresh run. Preserve the order invariant (method → auth → parse → token strip → preflight → first status side effect → run); the secret-auth and token-stripping tests must stay byte-for-byte green. Confirm `requestedAt` is required/validated by preflight (test "rejects invalid requestedAt" at `handle-discovery-webhook.test.ts:2407`) and note the finding.
- Existing tests pinning `run_queued`/random ids: adjust minimally in the same commit, naming `LIFECYCLE-1` in the message. `npm run test:contract:all` must stay green with NO contract/schema edits — if you believe a contract edit is needed, STOP and report.

**RED probes (run first, paste output):** pre-copied to `.lane-evidence/scout-worker/`:
```bash
node --experimental-strip-types --test .lane-evidence/scout-worker/lifecycle-duplicate-delivery.probe.test.ts
# observed RED on base: firstRunId=run_1 secondRunId=run_2 runDiscoveryCalls=2 discoveryRunsAppends=2
node --test .lane-evidence/scout-worker/lifecycle-poll-classification.probe.test.mjs
# only the two statusPath/status_path cases are yours (green today = characterization); the 404/401 cases belong to Lane D
```
Port the duplicate-delivery probe into `integrations/browser-use-discovery/tests/webhook/handle-discovery-webhook.test.ts` (or a new `tests/webhook/lifecycle-idempotency.test.ts` — that directory IS in the test glob) with the `LIFECYCLE-1:` prefix.

**Targeted gate:** `npm run test:browser-use-discovery` and `npm run typecheck:browser-use-discovery`; plus `npm test -- tests/<your root test>` if you add one.

**DoD:** RED pasted → GREEN pasted → targeted gates → full floor → diff reviewed, secret-scanned → ONE local commit `test(discovery-hardening/lifecycle): …` (or `fix(...)` if production changed) → SHA in report. Never push.
