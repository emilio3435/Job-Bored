FAIL

**Floor tails.** `npm run typecheck:browser-use-discovery` exited 0:

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json
```

`node scripts/run-tests.mjs integrations/browser-use-discovery/tests` produced this last test line, then the sandbox blocked `generativelanguage.googleapis.com` because the domain is not allowlisted. There was no suite result:

```text
✔ agent-browser command refuses a metadata URL before spawning agent-browser (62.375125ms)
```

`npm test` produced this tail, then the sandbox blocked `127.0.0.1` under its local/private network policy. There was no suite result:

```text
> command-center@0.1.0 test
> node scripts/run-tests.mjs
```

| Sev | Commit | File:line | Exact failure scenario | Proof |
|---|---|---|---|---|
| P1 | C1 `edfc7629` | [candidate-catalog.ts:363](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/candidate-catalog.ts:363), [profile-aware-scorer.ts:115](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts:115) | A backlog posting says “no visa sponsorship.” The user later requires sponsorship. Promotion rebuilds the listing without its description, so the sponsorship check passes and the lead can reach the Sheet. The profile change does not change the [intent key](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/run-discovery.ts:3611). | CONFIRMED by source |
| P2 | C1 | [candidate-catalog.ts:297](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/candidate-catalog.ts:297) | With 15 free slots, if the top 45 backlog rows fail today’s profile check and row 46 passes, the fixed `slots * 3` fetch stops before row 46. All 15 slots stay unused despite eligible backlog. | CONFIRMED by source |
| P2 | C1 | [run-discovery.ts:660](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/run-discovery.ts:660), [run-discovery.ts:2200](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/run-discovery.ts:2200) | If the Sheet write succeeds and subsequent role-family memory learning throws, the failure flush records those written leads as backlog. The original error is rethrown, but the catalog fate is wrong until a later run repairs it. | CONFIRMED by source |
| P3 | C2 `df4d1b15` | [discovery-memory-store.ts:1139](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/state/discovery-memory-store.ts:1139) | As coverage history grows across intent rotations, every planner snapshot ranks the entire `intent_coverage` table and calculates accepted totals for returned rows, though only ten rows per company are used. Latency on a large history was not measured. | PLAUSIBLE |
| P2 | C3 `9958bc24` | [runs-tab.js:554](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/runs-tab.js:554), [discovery-status-handoff.js:577](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/discovery-status-handoff.js:577) | After reload, a scheduled run from a hosted worker has a Run ID in DiscoveryRuns but no status token. The new hint fetch exits for non-local webhook URLs, so its filter hint never appears. The round-1 history finding is closed for local worker runs only. | CONFIRMED by source and [test expectation](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/tests/runs-tab.test.mjs:1349) |
| P2 | C3 | [runs-tab.js:503](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/runs-tab.js:503) | If one exclude keyword removes 30% of listings but `remote_unknown` removes 40%, the hint shows only the remote reason. Binding D9 requires a keyword hint when one keyword reaches 25%. | CONFIRMED by source |
| P2 | C3 | [job-matcher.ts:195](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/match/job-matcher.ts:195), [job-matcher.ts:498](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/match/job-matcher.ts:498) | A non-sales “Solutions Architect” target and an “Account Executive” listing whose description mentions “solutions consultant” now share a new family. That can raise role alignment to [0.85](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/match/job-matcher.ts:645) despite the unrelated title. | PLAUSIBLE impact; score path confirmed by source |

**Per-commit verdict.** C1’s normal write-fate mapping and novelty ordering close round-1 findings #1–#2 in their original scenarios, but promotion still bypasses a current hard constraint and can leave available slots empty. C2 closes round-1 findings #3–#5: coverage uses actual write fates, the prior matches amended D6, and merged targets no longer inflate the board-skip count. Its all-history query has an unmeasured scaling risk. C3 persists and serves `filterStats`, adds the Run ID header repair, and leaves filters unchanged; its historical hint remains unavailable for hosted scheduled runs and its reason-first hint can miss D9’s keyword trigger.

**Unverified and status.** The two test suites did not complete in this sandbox; live Google Sheets header repair, hosted browser behavior, and large-history query latency were not verified. Review and typecheck are done; those runtime gates are blocked; nothing remains in progress. `git status --porcelain` was empty before and after review. No tracked files were edited or committed.