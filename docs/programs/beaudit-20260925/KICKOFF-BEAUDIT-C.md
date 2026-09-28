# Lane C — Sources and ATS providers

Read `KICKOFF-BEAUDIT-_SHARED.md` in this folder first (boundaries, report format, silent traps, lenses, findings schema); it binds you. Then `PROGRAM-PROMPT.md` §"Lanes" row C and `PRIOR-CLAIMS.md`. Eight audit lanes (A–H) run now, each in its own worktree; none writes product code.

Goal: Audit both fetch layers and every ATS provider: pick the layer to keep, map provider test coverage, and prove whether every outbound fetch passes the SSRF guard.

Success means:
- `.lane-evidence/LANE-REPORT-C.md` in `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-C` holds all five sections; first line `DONE`.
- Section 2 inventories every entrypoint, store, external call and background job in your fence with `path:line` at `f227fbb`, caller, reads/writes, and test file.
- Section 3 holds at most 25 schema rows with IDs `C1`, `C2` …, every P0/P1 with a runnable reproducer, then a status for every prior-claim row listed below, then three so-whats.
- Section 4 holds pasted output for every CONFIRMED row and every focused test file you ran.
- Section 5 lists every INFERRED row with its proving command, plus what the boundaries blocked.

Stop when: all eight lenses are walked for this fence and the report's first line is `DONE`, or a whole-lane blocker makes it `BLOCKED: <why>`.

## Worktree and ports
- Worktree: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-C` (detached at `f227fbb`, `node_modules` and `server/node_modules` symlinked). Work only here.
- Probe ports: `18130–18139`. Sandbox HOME: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-C/.lane-evidence/home`.

## Fence (yours to audit)
- `integrations/browser-use-discovery/src/browser/**`
- `integrations/browser-use-discovery/src/sources/**`
- `integrations/browser-use-discovery/src/net/safe-fetch.ts` (and all of `integrations/browser-use-discovery/src/net/`)
- `server/shared/job-scraper-core.mjs`
- `server/shared/ats-job-fetchers.mjs`
- `server/shared/gemini-url-context-scrape.mjs`
- `server/shared/text-normalize.mjs`
- Reads `integrations/browser-use-discovery/src/discovery/career-surface-resolver.ts` alongside lane B

## Shared edges
- Lane E owns the `/api/scrape-job` route in `server/index.mjs` and `server/job-scraper.mjs`; you own the shared core they call.
- Lane D owns what happens to a lead after it is fetched (dedupe, Sheet write).

## Seed questions (start here, follow the evidence past them)
1. Map the two fetch layers (`server/shared` and the worker's `sources`): which functions overlap, which callers use which, and name the one to keep with a migration list.
2. Which of the providers in the registry (count them) have fixture-backed tests? Build a provider × (fetch, parse, fixture test, error path) table.
3. Does every outbound fetch go through the SSRF guard, including redirects and each hop? Grep every `fetch(`, `http.request`, `undici`, Playwright `goto` in the fence and classify each.
4. Do job boards stay hint-only (never written as the canonical URL)?
5. Does one failed ATS board discard its siblings (RUN-10)? Do AbortSignals propagate (RUN-11)? Does production ATS gating still recognize only three providers (RUN-07)?

## Prior claims you must answer (rows in `PRIOR-CLAIMS.md`)
- SEC-04
- RUN-07
- RUN-10
- RUN-11
- INGEST-01
- INGEST-04
- Wishlist T1-1 Capture inbox
- Wishlist T2 Field evidence ledger
- Wishlist T3 Job-site capture companion

## In-flight PRs touching your fence
- None touch your fence directly. #113 touches the scorer downstream of you (lane B).

Check each with `gh pr diff <n>` (read-only). A finding the PR fixes is `IN-FLIGHT #n` with one line on the PR's approach.

## Definition of Done
Report first line `DONE`; §4 holds real pasted output; every prior-claim row above has a status; every P0/P1 has a reproducer Muse can run read-only from `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-C`. No git writes, no product edits.

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.
