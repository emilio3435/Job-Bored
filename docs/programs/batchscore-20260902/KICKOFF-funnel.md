# KICKOFF — lane `funnel` (wave 2; branches from the green wave-1 integration commit)

Read `GROUND-RULES.md` and `BATCHSCORE-SPEC.md` §3 items 1 and 6, §4.3, §4.4, and locked decisions 2 and 7 first. Create `LANE-REPORT-funnel.md` before anything else.

## Mission
Per company, raw listings are ranked deterministically, only the top K go to the batch scorer (with a reserved slice for stretch-role title matches), the rest are counted as budget rejections, and scoring progress is checkpointed so the dashboard can show it.

## Fence (you own exactly these)
- `integrations/browser-use-discovery/src/run/run-discovery.ts` — the region immediately before each of the three normalize loops (the loops themselves belong to the `concurrency` lane's already-merged change; do not restructure them), the budget helper, and the progress emit.
- `integrations/browser-use-discovery/src/run/run-progress.ts` — add `DiscoveryRunScoringProgress` and the optional `scoring` field exactly as §4.3.
- `integrations/browser-use-discovery/src/contracts.ts` — the rejection-reason union only (add `llm_budget_exhausted`) and the optional `scoringBudget?: number` on `StoredWorkerConfig`. If a JSON schema or contract test enumerates rejection reasons, update that enumeration too and name the file in the report.
- `integrations/browser-use-discovery/tests/run/` — new tests.

## Consumes
- `scoreListingsBatchForProfile` from the `batch` lane, coded to the §4.2 signature. The batch lane runs in parallel with you; **stub it to that exact signature in your tests and import it by name in source**. If the import does not resolve on your branch yet, add a one-line stub module with that signature marked `// BATCHSCORE: replaced by lane batch` and say so in the report; the orchestrator resolves it at integration.
- `mapWithConcurrency` and the four-wide loops from the `concurrency` lane (on your base).
- `scoreListingMatch(rawListing, run).overallScore` from `match/job-matcher.ts` (deterministic; unchanged).
- `checkpointRunProgress(phase, budget?, at?)` in `run-discovery.ts` — extend its call shape minimally to carry `scoring`; the webhook already copies `progress` into the status row.

## Non-negotiables
- `K = max(20, min(50, 2 × maxLeadsPerRun))`, overridden by `storedConfig.scoringBudget` when it is a positive integer. Reserve `ceil(K / 4)` slots for listings whose title matches any pursued role (profile `identity.targetRoles` ∪ run `targetRoles`, case-insensitive substring) but whose rank fell below K; fill the remainder by rank. Ties by original order.
- Pre-filter rejections stay pre-filter rejections (they are not budget rejections). Listings beyond K are recorded through `recordRejection` with reason `llm_budget_exhausted` and detail `Ranked #<n> of <N>; LLM budget <K>.`, and are not normalized (locked decision 7).
- The top-K set is passed to `scoreListingsBatchForProfile` before the normalize loop so the loop hits cache; the loop itself is unchanged.
- Log `discovery.run.llm_budget_applied { runId, company, rawCount, budget, reserved }` once per company through `dependencies.log`.
- Progress: emit at most once per second per company via the checkpoint callback, `scored` counting cache hits, `total` the submitted count; final emit when the company completes. No direct status-store access from `run-discovery.ts`.
- The run's write-selection (`selectLeadsForWrite`) and the `maxLeadsPerRun` cap are untouched.
- Red-first tests, named for behavior: K formula and override; reserved slice admits a stretch title ranked below K; beyond-K listings become `llm_budget_exhausted` rejections with the exact detail string and never reach the normalizer; the batch scorer is called once per company with exactly the top-K set; progress checkpoints carry `scoring` and are rate-limited; a run with zero `userProfile` bypasses the funnel entirely (today's behavior).

## Definition of Done
1. Report section 2 shows every test above red, then green.
2. Full floor pasted into report section 4 (contract suite included — you touched a contract file):
   ```
   npm run typecheck:browser-use-discovery
   npm run test:browser-use-discovery
   npm run test:contract:all
   npm run lint:repo
   npm test
   ```
3. Commit locally (`feat(discovery): rank first, score the top K, count the rest`), never push. Keep scratch in `.lane-evidence/`. Delete nothing.
