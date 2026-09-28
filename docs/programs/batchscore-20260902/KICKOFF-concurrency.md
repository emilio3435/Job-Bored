# KICKOFF — lane `concurrency` (wave 1)

Read `GROUND-RULES.md` and `BATCHSCORE-SPEC.md` §1 (F1) and §4.5 first. Create `LANE-REPORT-concurrency.md` before anything else.

## Mission
The three places where `run-discovery.ts` normalizes raw listings one at a time now run up to four at once, with output that is byte-identical to the serial version for the same inputs. The AI-matcher call cap cannot be overshot by concurrent listings, and an abort mid-batch stops issuing new work.

## Fence (you own exactly these)
- New file `integrations/browser-use-discovery/src/run/map-with-concurrency.ts` — one named export, `mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>`, output in input order. No dependency added.
- `integrations/browser-use-discovery/src/run/run-discovery.ts` — the three `for (const rawListing of rawListings)` normalize loops (around lines 803, 1019, 2323 on the base) and the `matchingState` reservation described below. Nothing else in the file; the `funnel` lane edits the region before those loops in wave 2.
- `integrations/browser-use-discovery/tests/run/` — new tests (reuse the fake-dependencies harness the existing tests there use).

## Consumes
Nothing.

## Non-negotiables
- Limit is 4, as a named constant in `run-discovery.ts`, overridable only through an existing config path if one is already threaded to these loops; otherwise leave it a constant and say so.
- Order preservation: `normalizedLeads`, `extractionResult.leads`, `extractionResult.stats.leadsAccepted`, and rejection records via `recordRejection` are appended in the original listing order after the concurrent batch resolves. A test feeds listings whose fake scorer resolves in reverse order and asserts the run output ordering is unchanged from the serial baseline.
- AI-matcher cap: `matchingState.aiMatchCallsUsed` is reserved before the AI matcher call (increment on the decision to call, decrement on the non-AI path if the existing code increments only after), so `shouldUseAiMatcher(baseline, run, aiCallsUsed)` sees the reservation. A test with a fake matcher that delays proves the cap is never exceeded under concurrency 4. Read `normalizeRawListing` and `shouldUseAiMatcher` in full before touching the counter.
- Abort: the existing abort signal / budget-tracker path still stops the run. A test aborts while four listings are in flight and asserts no fifth `fn` call starts.
- Error isolation stays what it is today: a single listing's failure path (already handled inside `normalizeRawListing` / the surrounding try) must not reject the whole batch. Say in the report which path you verified.
- No change to what any single listing produces. This lane changes scheduling only.

## Definition of Done
1. Report section 2 shows the ordering, cap, and abort tests red on the base commit (the ordering test is red because the serial loop makes it trivially pass — state how you made it meaningful, e.g. by asserting the helper is used and the in-flight high-water mark reaches 4), then green.
2. Full floor pasted into report section 4:
   ```
   npm run typecheck:browser-use-discovery
   npm run test:browser-use-discovery
   npm run test:contract:all
   npm run lint:repo
   npm test
   ```
3. Commit locally (`perf(discovery): normalize listings four at a time, in order`), never push. Keep scratch in `.lane-evidence/`. Delete nothing.
