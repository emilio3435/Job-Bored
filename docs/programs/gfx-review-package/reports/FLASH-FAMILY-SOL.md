# Flash family integration

Goal: Finish the approved Flash family migration in the browser and server without changing explicit nonfamily pins.

Success means: A saved legacy 3.7 family default becomes logical `gemini-flash`, calls use `gemini-flash-latest`, explicit pins remain exact, and focused synthetic regressions and type/syntax checks pass.

Stop when: Source is ready for independent review and the host can run the complete floor on a clean snapshot. No commit, live provider call, preview restart, or publication in this lane.

## Starting evidence

- Approved plan: `.lane-evidence/FLASH-PLAN-GROK.md`.
- Preserve the initial root RED (13 passing, 15 failing) and worker RED (2 passing, 2 failing) from the host's evidence logs.
- Previously completed and retained: shared server resolver, core pin migration, resume fallback repair, worker five-edge mapping, and worker focused/typecheck green.
- Root RED evidence: `.lane-evidence/FLASH-RED-root.log` records 28 tests, 13 passing and 15 failing. Worker RED evidence: `.lane-evidence/FLASH-RED-worker.log` records 4 tests, 2 passing and 2 failing.

## Final evidence

Confirmed implementation: Browser selection paths (`oneflow-beat-ai.js`, `settings-modal.js`, `discovery-drawer.js`, `resume-generate.js`) store and submit logical `gemini-flash` for the old generated 3.7 default. Other explicit models remain selected. Gemini HTTP edges use `gemini-flash-latest`; its discovery and resume calls retain the 8192 thinking budget. Server profile request parsing, the URL-context scrape, and the discovery worker use the same rule. The shared server pin loader normalizes an exact legacy pin in memory without rewriting disk; ordinary save routes persist the logical id. A blocked localStorage migration write returns the successfully read config and credentials.

Focused root command, full output in `.lane-evidence/FLASH-FOCUSED-GREEN.log`:

```text
$ node --test tests/model-family.test.mjs tests/llm-config.test.mjs tests/beaudit-q-llm-config.test.mjs tests/gemini-model-fallback.test.mjs tests/gemini-flash-alias-wire.test.mjs tests/llm-pin-consumers.test.mjs tests/beaudit-q-scrape-gemini.test.mjs tests/sixbeats2-server-provider-config.test.mjs tests/settings-fit-profile-and-gemini-models.test.mjs tests/oneflow-l1-beat-ai.test.mjs tests/gfx-fe-b2b3-beat-ai.test.mjs tests/oneflow-l1-beat-resume.test.mjs tests/greenfield-d-effective-config.test.mjs tests/flash-family-persistence.test.mjs
ℹ tests 155
ℹ suites 51
ℹ pass 155
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7130.316958
```

Worker focused regression command and output:

```text
$ node --experimental-strip-types --test integrations/browser-use-discovery/tests/config-llm-pin.test.ts integrations/browser-use-discovery/tests/discovery/flash-wire-edges.test.ts
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 118.894417
```

Typechecks:

```text
$ npm run typecheck:server
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

$ npm run typecheck:browser-use-discovery
> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json
```

Targeted ESLint on changed browser/server JS and root tests exited 0 with no output. `git diff --check` exited 0 with no output. Syntax checks of changed browser and server JS exited 0. The earlier targeted ESLint failure was one unused helper left by deleting `models.list` handling; that helper was removed before the final green lint.

New untracked tests to include in the host snapshot: `tests/flash-family-persistence.test.mjs` and `integrations/browser-use-discovery/tests/discovery/flash-wire-edges.test.ts`. The synthetic root test covers blocked browser storage, Beat 2 pin POST, Beat 3 profile POST, request parse and wire mapping, and server read versus save persistence. No owner credential or live provider was read or called.

Host-owned gates still unverified in this live checkout: complete root suite, complete worker suite, repo lint/typecheck, browser QA, CI, deployment, and production. No commit or preview restart was made.

## Independent root floor follow-up

The host's independent `npm test` found one stale wire URL assertion in `tests/discovery-ai-call-configured-routing.test.mjs`; the request correctly used `gemini-flash-latest`. Updated only that expected URL. The existing dispatch, request body, and header checks remain in place.

```text
$ node --test tests/discovery-ai-call-configured-routing.test.mjs
ℹ tests 16
ℹ suites 1
ℹ pass 16
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 43.559375
```

The host will rerun the complete root floor after syncing this test-only change.

## Worker VAL-ROUTE-016 investigation

Goal: Compare the exact failing attribution probe against baseline `72de9704` and the Flash candidate, then restore deterministic company failure attribution without weakening its assertions.

Starting evidence: The host's complete worker run at `/private/tmp/jobbored-flash-verify/.lane-evidence/FLASH-HOST-test-repo.log` reported 945 passing, 1 failing of 946 worker tests. The failure was the VAL-ROUTE-016 probe at `routing-enforcement.test.ts:2070`, after 12 seconds. The test file is unchanged from baseline; it stores only the last `discovery.run.company_failed` log context while `GoodCompany` may also fail during downstream collection. Causality is under targeted investigation.

Confirmed comparison: `git diff 72de9704 --` for both `routing-enforcement.test.ts` and `run-discovery.ts` was empty before this fixture repair. In an isolated clean `72de9704` worktree with linked dependencies, the exact targeted test passed 1/1 in 110.8 ms (308.9 ms total). The candidate before this repair also passed 1/1 in 234 ms (403.9 ms total). Thus the Flash source changes did not introduce a deterministic worker failure; the host's one failure was timing dependent.

Causal negative control in that isolated baseline worktree: temporarily make both companies fail and order `FailingCompany` before `GoodCompany`. The old callback logged both structured events, then overwrote the FailingCompany context with GoodCompany's later event. The exact original assertion failed:

```text
$ node --experimental-strip-types --test --test-name-pattern='VAL-ROUTE-016: company failure emits explicit company-attributed failure evidence' integrations/browser-use-discovery/tests/webhook/routing-enforcement.test.ts
NEGATIVE_CONTROL_EVENT {"company":"FailingCompany",...}
NEGATIVE_CONTROL_EVENT {"company":"GoodCompany",...}
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError: Failure attribution should name the failed company
```

Confirmed fix: The test now records every `discovery.run.company_failed` context and asserts that one names FailingCompany. It also supplies a valid synthetic HTML response to GoodCompany's strict URL preflight, checks that preflight was exercised, and restores `globalThis.fetch` in `finally`. Existing FailingCompany log, diagnostic, and warning assertions remain. The test-only patch has no production source change. The full-suite GoodCompany failure mechanism is inferred from the unmocked network dependency; the host log did not capture a per-company event trace.

```text
$ node --experimental-strip-types --test --test-name-pattern='VAL-ROUTE-016: company failure emits explicit company-attributed failure evidence' integrations/browser-use-discovery/tests/webhook/routing-enforcement.test.ts
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ duration_ms 278.823125

$ npm run typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json
# exit 0

$ git diff --check -- integrations/browser-use-discovery/tests/webhook/routing-enforcement.test.ts
# exit 0
```

The host owns the next complete worker/repo floor after integrating the current main branch. No full suite was rerun in the live candidate.

## Tracked example defaults

The three example env templates now set their Gemini model default to the logical `gemini-flash` family: `integrations/browser-use-discovery/.env.example`, `server/.env.example`, and `server/ats-env.example`. `git diff` confirms exactly one model-value replacement in each file and no other setting change. `git diff --check -- integrations/browser-use-discovery/.env.example server/.env.example server/ats-env.example` exited 0 with no output. No actual `.env` or owner config was read or edited. This template-only change was not tested in the live checkout; the host's pending `test:repo` run includes the examples.

## Main integration resolution

Confirmed input: Host checkpoint `062cad14` contained the reviewed Flash and review-package changes. The host started `git merge --no-commit --no-ff main` (`5d5b9a59`); the merge had exactly three unmerged paths: `run-discovery.ts`, `server/materials-writer.mjs`, and `tests/materials-writer.test.mjs`. I resolved those and staged them with the one adapted worker progress test. `git ls-files -u` is empty, and `git diff --cached --check` exited 0. No commit was made.

The run-discovery conflict paired an obsolete ATS frontier filter from the older branch (`filteredNormalizedLeads`, removed by main) with main's grounded-only frontier selection. Kept main's grounded selection and budget warning; dropped the stale reference and did not discard ATS/SerpApi leads. Replaced a literal NUL separator introduced by main in one template string with equivalent `\u0000` source text so TypeScript remains plain text.

The writer conflicts paired our per-attempt bounded output budget and provider stop-signal diagnostics with main's narrow v3 stage prompt/cap. The merged provider calls now receive each attempt's budget, retain stage `systemPrompt`/`userText`, and use JSON mode for narrow stages while legacy OpenRouter/local wide calls remain plain JSON. `callJsonStage` now unwraps `{ text, finish }`, doubles a narrow cap once on truncation up to 16,384, rejects parseable-but-truncated output, and reports Gemini blocking reasons without retry. The merged writer test keeps both the wide truncation/blocked regressions and v3 stage checks; new stage tests cover a 500→1,000 retry and immediate `SAFETY` failure.

The focused worker batch initially ran 102 tests with 101 passing. Its single failure was UXD-BE-1 at the assertion for an old ATS `frontier_filtering.originalLeadCount` event. Instrumentation confirmed main now has no ATS frontier event: the scout processed and qualified 500 identical fixture listings, then write-side dedupe reduced them to 1. The adapted test retains all bounded progress/heartbeat assertions and positively checks 500 processed, 500 qualified at write and learn, 500 normalized, 1 deduped, and 1 selected for write. Exact retest passed 1/1.

```text
$ node --test tests/materials-writer.test.mjs
ℹ tests 26
ℹ pass 26
ℹ fail 0

$ node --test tests/materials-pipeline.test.mjs tests/materials-stages.test.mjs tests/materials-writer.test.mjs tests/flash-family-persistence.test.mjs tests/model-family.test.mjs tests/llm-pin-consumers.test.mjs
ℹ tests 59
ℹ pass 59
ℹ fail 0

$ node --experimental-strip-types --test --test-name-pattern='UXD-BE-1: a 500-listing ATS scout publishes bounded, cumulative progress' integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts
ℹ tests 1
ℹ pass 1
ℹ fail 0

$ npm run typecheck:server
> tsc --noEmit --project server/tsconfig.json
# exit 0
$ npm run typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json
# exit 0
```

The host owns independent Grok review and Muse full floors on a detached integrated snapshot. No full suite was rerun after the merge in this live candidate.

## Detached desktop self-test omission

The first detached integrated `npm test` reported `ERR_MODULE_NOT_FOUND` for `server/materials-pipeline.mjs` from `server/materials-drafter.mjs` in the desktop self-test's read-only app copy. This was a verification-snapshot staging artifact, not a missing candidate runtime asset. `stageAppCopy` deliberately copies only `git ls-files` paths. The candidate merge index tracks `server/materials-pipeline.mjs`, `server/materials-ledger.mjs`, and `server/materials-draft.mjs`; the detached verification checkout has those files on disk as `??` untracked. Its `git ls-files server/materials-pipeline.mjs` returned nothing. The production desktop staging predicate already includes `server/` and `schemas/` runtime paths. No source or test change was needed.

The same existing desktop self-test on the candidate passed, including the three server probes, zero writes under the read-only app copy, and freed ports 18580–18582:

```text
$ node --test tests/gfx-desk-b-desktop-selftest.test.mjs
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 5575.083333
```

The host must mark copied new files as tracked in the detached verification checkout before rerunning its full floor; the candidate requires no runtime allowlist patch.

## Setup endpoint listener-fixture isolation

The detached integrated floor then exposed one inherited test dependency on the live worker at 8644: `tests/fix-setup-endpoint.test.mjs` expected two injected stale listeners to be killed, but observed one. Before this fixture edit, `git diff --exit-code main -- dev-server.mjs tests/fix-setup-endpoint.test.mjs` exited 0, proving the implementation and test matched current main exactly. `killFullBootStalePorts` defaults to a real `/health` ownership probe even when `findProcesses` and `killPid` are injected; another checkout's worker can make the synthetic 8644 listener appear foreign. The production foreign-checkout safeguard is correct and unchanged.

The affected test now injects `resolveWorkerOwnership: async () => ({ foreign: false, repoRoot: "ours" })`, so its subject is solely the two known-listener termination actions. The separate foreign-checkout tests still assert that a foreign worker is blocked without a kill. No live process was killed.

```text
$ node --test tests/fix-setup-endpoint.test.mjs tests/dev-server-foreign-checkout.test.mjs
ℹ tests 26
ℹ pass 26
ℹ fail 0

$ git diff --check -- tests/fix-setup-endpoint.test.mjs
# exit 0
```

The one-file fixture correction is staged; the host owns the independent full-floor rerun.
