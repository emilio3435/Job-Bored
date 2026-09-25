# Lane B — Discovery engine

Read `KICKOFF-BEAUDIT-_SHARED.md` in this folder first (boundaries, report format, silent traps, lenses, findings schema); it binds you. Then `PROGRAM-PROMPT.md` §"Lanes" row B and `PRIOR-CLAIMS.md`. Eight audit lanes (A–H) run now, each in its own worktree; none writes product code.

Goal: Audit the discovery engine: where a run spends tokens and wall time, what memory learns and reads back, why runs end as zero-lead partials, and where the two giant files hide seams.

Success means:
- `.lane-evidence/LANE-REPORT-B.md` in `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-B` holds all five sections; first line `DONE`.
- Section 2 inventories every entrypoint, store, external call and background job in your fence with `path:line` at `f227fbb`, caller, reads/writes, and test file.
- Section 3 holds at most 25 schema rows with IDs `B1`, `B2` …, every P0/P1 with a runnable reproducer, then a status for every prior-claim row listed below, then three so-whats.
- Section 4 holds pasted output for every CONFIRMED row and every focused test file you ran.
- Section 5 lists every INFERRED row with its proving command, plus what the boundaries blocked.

Stop when: all eight lenses are walked for this fence and the report's first line is `DONE`, or a whole-lane blocker makes it `BLOCKED: <why>`.

## Worktree and ports
- Worktree: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-B` (detached at `f227fbb`, `node_modules` and `server/node_modules` symlinked). Work only here.
- Probe ports: `18120–18129`. Sandbox HOME: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-B/.lane-evidence/home`.

## Fence (yours to audit)
- `integrations/browser-use-discovery/src/run/run-discovery.ts`
- `integrations/browser-use-discovery/src/run/frontier-scorer.ts`
- `integrations/browser-use-discovery/src/run/budget-tracker.ts`
- `integrations/browser-use-discovery/src/run/retry-broadening.ts`
- `integrations/browser-use-discovery/src/discovery/*`
- `integrations/browser-use-discovery/src/grounding/grounded-search.ts`
- `integrations/browser-use-discovery/src/match/*`
- `integrations/browser-use-discovery/src/normalize/*`
- `integrations/browser-use-discovery/src/ai/chat-provider.ts`
- `integrations/browser-use-discovery/src/state/discovery-memory-store.ts`
- `integrations/browser-use-discovery/src/state/listing-score-cache.ts`
- `integrations/browser-use-discovery/src/state/run-discovery-memory-store.ts`
- Also yours: any other `integrations/browser-use-discovery/src/run/*` file not named by lane A

## Shared edges
- Lane C reads `discovery/career-surface-resolver.ts` alongside you; you own its role in the run, C owns its fetch behavior.
- Lane E owns the server-side AI provider layer; you own `ai/chat-provider.ts`. Both of you cite the other's site for the lens 6 duplication row.

## Seed questions (start here, follow the evidence past them)
1. Where does a run spend tokens and wall time? Build a per-stage table (calls, tokens, ms) from code and from a stubbed test run; estimate tokens per typical run.
2. What does the memory store learn, and what reads it back? Name any write-only memory.
3. Why do runs end as zero-lead partials? Trace each path that yields `partial` with 0 leads.
4. Where are the seams inside the 4,386-line `grounded-search.ts` and the 3,014-line run loop? Propose the split with line ranges.
5. Is retry broadening gated by its flag in the outbound call sequence (RUN-06)? Are blocklist, grounded-web opt-out and unknown allowlist entries honored (DISC-04/05/06)?

## Prior claims you must answer (rows in `PRIOR-CLAIMS.md`)
- DISC-03
- DISC-04
- DISC-05
- DISC-06
- PIPE-03
- RUN-06
- RUN-08
- RUN-09
- Wishlist T0 Effective discovery preview
- Wishlist T1-3 Saved searches
- Wishlist T3 Experiment lab

## In-flight PRs touching your fence
- #107, #108, #109 — Partial/zero-lead Error reasons in `run-discovery.ts`
- #110 — `discovery/effective-intent.ts` empty-catalog allowlist seeding
- #113 — `normalize/profile-aware-scorer.ts` accepts inferred-remote under remote_only

Check each with `gh pr diff <n>` (read-only). A finding the PR fixes is `IN-FLIGHT #n` with one line on the PR's approach.

## Definition of Done
Report first line `DONE`; §4 holds real pasted output; every prior-claim row above has a status; every P0/P1 has a reproducer Muse can run read-only from `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-B`. No git writes, no product edits.

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.
