FAIL

**Floor tails (CONFIRMED).** `npm run typecheck:browser-use-discovery` exited 0:
```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json
```
`node scripts/run-tests.mjs integrations/browser-use-discovery/tests` returned no test tail: the sandbox blocked access to `generativelanguage.googleapis.com` because the domain is not allowlisted. `npm test` returned no test tail: the sandbox blocked access to `127.0.0.1` under its local/private network policy. I did not work around either block.

| Sev | Commit | File:line | Exact failure scenario | Proof |
|---|---|---|---|---|
| P1 | C1 `d97f3863` | [run-discovery.ts:2143](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/run-discovery.ts:2143) | The Sheet writer can skip a dismissed lead or semantic collision without `writeError`, yet every selected lead becomes `written` and every selected backlog key becomes `promoted`. Those terminal catalog statuses then preserve a fate that never happened. | CONFIRMED |
| P2 | C1 `d97f3863` | [candidate-catalog.ts:219](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/candidate-catalog.ts:219) | Change target roles or exclude keywords on the same sheet, then run within 14 days without seeing an old backlog lead again. Promotion checks its payload and company scope only, so the old lead can be sent to the Sheet under filters it no longer passes. | CONFIRMED |
| P2 | C2 `e77e32fa` | [run-discovery.ts:2045](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/run-discovery.ts:2045), [ats-yield-steering.ts:242](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/ats-yield-steering.ts:242) | `intent_coverage.listingsWritten` counts leads selected for writing, including Sheet failures and skips. After two runs and ≥150 listings with zero actual writes, a positive selected count prevents the required zero-yield cooldown. | CONFIRMED |
| P2 | C2 `e77e32fa` | [ats-yield-steering.ts:274](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/ats-yield-steering.ts:274) | D6 specifies an unknown-company prior of `0.5`; the code uses half the mean observed yield (or `0.005` with no positive history). A new company therefore receives a materially different rank from the binding decision. | CONFIRMED |
| P3 | C2 `e77e32fa` | [run-discovery.ts:1147](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/run-discovery.ts:1147) | Two targets for one company can merge while pointing to two distinct boards. Both boards are listed, but `atsBoardDuplicatesSkipped` and the duplicate-skipped event still count one skipped board. | CONFIRMED |
| P2 | C3 `029811a4` | [runs-tab.js:823](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/runs-tab.js:823), [runs-tab.js:1008](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/runs-tab.js:1008) | The hint comes only from a locally tracked live run and is kept in page memory after its Sheet row arrives. Scheduled runs have no such live state; after a matched run is cleared and the page reloads, its historical hint disappears. | CONFIRMED |

**Per-commit verdict.** C1 fails D2/D3 fate and reuse correctness. C2 implements board-key dedupe and a cooldown path, but its yield input and unknown prior fail D6; its duplicate metric is inaccurate. C3 persists and serves filter stats through the run-status payload, and its near-miss path does not change filters, but the dashboard hint does not cover scheduled or reloaded history. The new tests assert observable behavior and would fail if their main feature paths were deleted; they do not cover the failure scenarios above.

**Unverified.** Worker tests, root tests, and the frontend Playwright smoke were not verified in this sandbox. This report is a diff and source review, not runtime proof of those paths. `git status` was clean on `feat/discovery-candidate-catalog` before and after review; no tracked files were edited or committed.