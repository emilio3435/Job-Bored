# Lane A — Ingress and run lifecycle

Read `KICKOFF-BEAUDIT-_SHARED.md` in this folder first (boundaries, report format, silent traps, lenses, findings schema); it binds you. Then `PROGRAM-PROMPT.md` §"Lanes" row A and `PRIOR-CLAIMS.md`. Eight audit lanes (A–H) run now, each in its own worktree; none writes product code.

Goal: Audit the worker's HTTP ingress and run lifecycle: every route's order invariant, retries, terminal states, and schema-vs-code agreement.

Success means:
- `.lane-evidence/LANE-REPORT-A.md` in `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-A` holds all five sections; first line `DONE`.
- Section 2 inventories every entrypoint, store, external call and background job in your fence with `path:line` at `f227fbb`, caller, reads/writes, and test file.
- Section 3 holds at most 25 schema rows with IDs `A1`, `A2` …, every P0/P1 with a runnable reproducer, then a status for every prior-claim row listed below, then three so-whats.
- Section 4 holds pasted output for every CONFIRMED row and every focused test file you ran.
- Section 5 lists every INFERRED row with its proving command, plus what the boundaries blocked.

Stop when: all eight lenses are walked for this fence and the report's first line is `DONE`, or a whole-lane blocker makes it `BLOCKED: <why>`.

## Worktree and ports
- Worktree: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-A` (detached at `f227fbb`, `node_modules` and `server/node_modules` symlinked). Work only here.
- Probe ports: `18110–18119`. Sandbox HOME: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-A/.lane-evidence/home`.

## Fence (yours to audit)
- `integrations/browser-use-discovery/src/server.ts`
- `integrations/browser-use-discovery/src/webhook/*`
- `integrations/browser-use-discovery/src/http/*`
- `integrations/browser-use-discovery/src/state/run-status-store.ts`
- `integrations/browser-use-discovery/src/run/run-abort.ts`
- `integrations/browser-use-discovery/src/run/run-progress.ts`
- `integrations/browser-use-discovery/src/contracts.ts`
- `schemas/*` (except `pipeline-row.v1.json`, which lane D owns)
- `examples/*`
- `AGENT_CONTRACT.md`
- Also yours (unassigned elsewhere): `integrations/browser-use-discovery/src/index.ts`, `integrations/browser-use-discovery/src/config.ts`, `integrations/browser-use-discovery/src/state/*` files no other lane names

## Shared edges
- `W/webhook/handle-pipeline-update.ts` is a shared read with lane D (you own the ingress order; D owns the Sheet write).
- Lane B owns `run-discovery.ts`; you trace into it only as far as the lifecycle hooks (status writes, abort, watchdog).

## Seed questions (start here, follow the evidence past them)
1. Does the order invariant (method → secret → parse → token strip → preflight → first side effect → run) hold on `/webhook`, `/discovery`, `/discovery-profile`, `/ingest-url`, `/cleanup-expired`, `/pipeline-update` and `/runs/:id`? Build a per-route table.
2. What does a retried POST do (same body, same idempotency key if any)? Probe it against a sandbox worker on your port.
3. Which runs never reach a terminal state (watchdog, catastrophic throw, process restart mid-run)? Is a terminal status immutable?
4. Where do `schemas/*` + `examples/*` + `AGENT_CONTRACT.md` and the TypeScript parsers disagree? List each field.
5. Does a malformed percent-encoded path crash the worker listener (SEC-05)?

## Prior claims you must answer (rows in `PRIOR-CLAIMS.md`)
- SEC-05 (worker half)
- DISC-02
- RUN-01
- RUN-02
- RUN-03 (server half)
- RUN-05
- P2-RUNTOKEN
- P2-PIPEUPD
- P2-MULTISHEET
- TD-007
- TD-008
- Wishlist T1-8 Source-quality run drill-down

## In-flight PRs touching your fence
- #102 discovery hardening — `run-status-store.ts`, `handle-discovery-webhook.ts`, `lifecycle-idempotency.test.ts`
- #107, #108, #109 — Partial-run Error reasons; touch `run-status-store.ts`, `webhook/safety-timer.ts`, `config.ts`
- #110 — `contracts.ts` empty-catalog allowlist fallback

Check each with `gh pr diff <n>` (read-only). A finding the PR fixes is `IN-FLIGHT #n` with one line on the PR's approach.

## Definition of Done
Report first line `DONE`; §4 holds real pasted output; every prior-claim row above has a status; every P0/P1 has a reproducer Muse can run read-only from `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-A`. No git writes, no product edits.

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.
