# KICKOFF — lane `infra` (wave 1)

Read `GROUND-RULES.md` and `BATCHSCORE-SPEC.md` §1 (F4, F5) and §4.6 first. Create `LANE-REPORT-infra.md` before anything else.

> **SCOPE CHANGE 2026-09-02 20:50 CDT (orchestrator):** E.1 (worker log file) is already implemented on open PR #101 (`fix/worker-log-capture`: `dev-server.mjs` + `tests/discovery-worker-log-capture.test.mjs`, CI green). **Do not touch `dev-server.mjs`. This lane does E.2 only.** Record the scope change in report section 1.

## Mission
A run whose terminal status write throws ends as `failed` instead of staying `running` forever. (The worker log file, E.1, ships separately via PR #101.)

## Fence (you own exactly these)
- `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts` — the two terminal branches (`.then` completed and `.catch` failed) only.
- `integrations/browser-use-discovery/tests/webhook/` — new or extended tests.

## Consumes
Nothing. No other lane touches these lines. The base branch already carries `feat/discovery-hardening`'s edits to the webhook file; read them before editing so you extend, not overwrite.

## Non-negotiables
- E.2: in both terminal branches, `runStatusStore.put(...)` executes first; `safety.markTerminal()` and `safety.clear()` execute only after it returns. The `.catch` branch's existing try/catch around its put stays. The `isTerminalStatusWritten()` guards stay.
- Red-first test for E.2: a fake `runStatusStore` whose `put` throws when the row's status is `completed`. Before your change the final stored row is `running` and the log carries `discovery.run.late_failure_ignored`. After: the final stored row is `failed`, and `late_failure_ignored` is not logged. Name the test for the behavior ("ends failed when the completed write throws").
- Do not change what `buildCompletedRunStatus` / `buildFailedRunStatus` produce.

## Definition of Done
1. Report section 2 shows the E.2 test red on the base commit, then green.
2. Full floor pasted into report section 4:
   ```
   npm run typecheck:browser-use-discovery
   npm run test:browser-use-discovery
   npm run test:contract:all
   npm run lint:repo
   npm test
   ```
4. Commit locally (`fix(discovery): …`), never push. Keep scratch in `.lane-evidence/`. Delete nothing.
