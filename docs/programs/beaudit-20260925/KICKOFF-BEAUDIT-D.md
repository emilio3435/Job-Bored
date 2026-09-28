# Lane D — Sheets persistence and data integrity

Read `KICKOFF-BEAUDIT-_SHARED.md` in this folder first (boundaries, report format, silent traps, lenses, findings schema); it binds you. Then `PROGRAM-PROMPT.md` §"Lanes" row D and `PRIOR-CLAIMS.md`. Eight audit lanes (A–H) run now, each in its own worktree; none writes product code.

Goal: Audit every writer to the user's Sheet: dedupe under concurrency, header drift, user-edited columns, API call counts and quota, half-written batches, and where the worker, Apps Script and browser writers diverge.

Success means:
- `.lane-evidence/LANE-REPORT-D.md` in `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-D` holds all five sections; first line `DONE`.
- Section 2 inventories every entrypoint, store, external call and background job in your fence with `path:line` at `f227fbb`, caller, reads/writes, and test file.
- Section 3 holds at most 25 schema rows with IDs `D1`, `D2` …, every P0/P1 with a runnable reproducer, then a status for every prior-claim row listed below, then three so-whats.
- Section 4 holds pasted output for every CONFIRMED row and every focused test file you ran.
- Section 5 lists every INFERRED row with its proving command, plus what the boundaries blocked.

Stop when: all eight lenses are walked for this fence and the report's first line is `DONE`, or a whole-lane blocker makes it `BLOCKED: <why>`.

## Worktree and ports
- Worktree: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-D` (detached at `f227fbb`, `node_modules` and `server/node_modules` symlinked). Work only here.
- Probe ports: `18140–18149`. Sandbox HOME: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-D/.lane-evidence/home`.

## Fence (yours to audit)
- `integrations/browser-use-discovery/src/sheets/*`
- `integrations/browser-use-discovery/src/cleanup/expired-job-cleanup.ts`
- `integrations/browser-use-discovery/src/webhook/handle-pipeline-update.ts` (shared read with lane A)
- `integrations/apps-script/Code.gs`
- `schemas/pipeline-row.v1.json`
- `scripts/run-scheduled-expired-cleanup.mjs`
- Reads `sheets-writeback.js` (browser) for comparison only

## Shared edges
- Lane A owns ingress order on `/pipeline-update`; you own what it writes.
- Lane B owns run-level dedupe; you own persisted-row dedupe. Cite both sites where they overlap.

## Seed questions (start here, follow the evidence past them)
1. Does dedupe-by-URL hold under two concurrent runs? Build a probe against a fake Sheets client (the tests have one) that interleaves two appends.
2. What happens to header drift (reordered, renamed, extra, missing columns) and to user-edited columns on update?
3. How many Sheets API calls does one run make, and against which quota (per-user 60 req/min read/write)? Count from code for a 20-lead run.
4. How does a half-written batch recover (append succeeded, DiscoveryRuns row failed; or the reverse)?
5. Where do the worker, Apps Script (`Code.gs`) and browser (`sheets-writeback.js`) stage writers diverge? Build a column × writer table.

## Prior claims you must answer (rows in `PRIOR-CLAIMS.md`)
- PIPE-04
- PIPE-05
- PIPE-06
- PIPE-07
- RUN-04
- INGEST-03
- APPLY-01 (persistence half)
- TD-001
- TD-016
- TD-021
- Wishlist T0 Explicit submission confirmation
- Wishlist T0 Closure and restore model
- Wishlist T1-2 Duplicate review
- Wishlist T1-5 Decision facts feed
- Wishlist T2 Event-sourced timeline
- Wishlist T2 True outcome funnel
- Wishlist T3 Search health dashboard

## In-flight PRs touching your fence
- #107, #108, #109, #113 — all touch `sheets/discovery-runs-writer.ts` (Partial-run Error reasons)

Check each with `gh pr diff <n>` (read-only). A finding the PR fixes is `IN-FLIGHT #n` with one line on the PR's approach.

## Definition of Done
Report first line `DONE`; §4 holds real pasted output; every prior-claim row above has a status; every P0/P1 has a reproducer Muse can run read-only from `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-D`. No git writes, no product edits.

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.
