# BATCHSCORE — discovery scoring: from 25-minute serial runs to a bounded, batched, visible funnel (2026-09-02)

Source spec (Gemini-authored, reviewed by the orchestrator against source on 2026-09-02):
`~/.gemini/antigravity-cli/brain/1ee6faec-0602-4e28-9bd5-a5ffa7aed1a7/batched-discovery-scoring-spec.md`.
This document supersedes it wherever the two disagree. Section 3 lists the six defects found in review and how each is resolved.

Goal: A discovery run against a 200-listing ATS board finishes scoring in under a minute, the dashboard shows scoring progress while it runs, worker output is on disk, a failed terminal status write can never leave a run stuck on "running", and stretch-role listings are judged against the roles the user is pursuing instead of only their past titles.

Success means:
- Every lane below has a red-first test that fails on main @ 04433c6 and passes on the integration branch.
- Full floor green on integration: `npm test`, `npm run test:browser-use-discovery`, `npm run test:contract:all`, `npm run lint:repo`, `npm run typecheck:browser-use-discovery`.
- A real run on Emilio's machine against the same board that took 25 minutes (variation `9f85a5d2110dd554`) is timed from the new `worker.log` and recorded in `evidence/LIVE-CHECK.md`.

Stop when: the integration branch is merged to main through CI and LIVE-CHECK.md is filed.

## 1. Findings → root cause (orchestrator-verified in source) → lane

| # | Finding | Root cause (verified) | Lane |
|---|---|---|---|
| F1 | Worker stays "running" 25+ min; 200+ sequential Gemini calls | `run-discovery.ts` awaits `normalizeRawListing` one listing at a time at three call sites (~803, ~1019, ~2323); each calls `scoreListingForProfile` → one LLM request | concurrency (wave 1), batch + funnel (wave 2) |
| F2 | Stretch roles scored 1–2/10 "deviates from your background" | `buildSystemPrompt` in `profile-aware-scorer.ts` injects only `primaryNarrative`, strengths, wants/avoids. `profile.identity.targetRoles`, `targetSeniority`, and the run's `config.targetRoles` / `includeKeywords` never reach the prompt | intent |
| F3 | Dashboard polls static JSON for 20 min | `checkpointRunProgress` fires only at phase boundaries; `DiscoveryRunProgress` (`run-progress.ts`) has no per-listing counter | funnel (worker side), progress-ui (dashboard side) |
| F4 | Worker stdout/stderr discarded | `dev-server.mjs:594` spawns the detached worker with `stdio: "ignore"` | **covered by PR #101** (`fix/worker-log-capture`, another session, CI green); reaches this branch via main. Not a lane. |
| F5 | A run can be stuck "running" forever | `handle-discovery-webhook.ts` ~429/~464: `safety.markTerminal()` runs before `runStatusStore.put(...)`. If the completed-put throws, the rejection reaches `.catch`, which sees the terminal flag and logs `late_failure_ignored`; no terminal status is ever written | infra |

## 2. Waves and lanes

**Wave 1 — ship-now fixes, disjoint fences, run in parallel.** Integrate and run the floor. Wave 2 spawns from the green wave-1 integration commit with no timing gate (locked decision 1); the real-run timing is still recorded after each wave for the evidence file.

| Lane | Model / vehicle | Fence (owns) | Consumes |
|---|---|---|---|
| infra | GPT 5.6 Sol xhigh via Codex | `dev-server.mjs` (the worker spawn block only), `handle-discovery-webhook.ts` (the two terminal branches only), `tests/webhook/` | nothing |
| intent | GPT 5.6 Sol xhigh via Codex | `profile-aware-scorer.ts` (`ScoreListingForProfileOptions`, `buildSystemPrompt`, `scoreListingWithLlm` prompt assembly only), `lead-normalizer.ts` (the single `scoreListingForProfile` call site), new `tests/profile-aware-scorer-intent.test.ts` | nothing |
| concurrency | GPT 5.6 Sol xhigh via Codex | `run-discovery.ts` (the three normalize loops and `matchingState`), new `src/run/map-with-concurrency.ts`, `tests/run/` | nothing |

**Wave 2 — batching and the funnel.** Branch from the wave-1 integration commit.

| Lane | Model / vehicle | Fence (owns) | Consumes |
|---|---|---|---|
| batch | GPT 5.6 Sol xhigh via Codex | `profile-aware-scorer.ts` (a new "batch" section below the single-item orchestrator; may not edit `buildSystemPrompt`), new `tests/profile-aware-scorer-batch.test.ts` | intent's prompt builder |
| funnel | GPT 5.6 Sol xhigh via Codex | `run-discovery.ts` (triage before the loops, budget, rejection reason), `run-progress.ts` (progress shape), `contracts.ts` (rejection-reason enum only), `tests/run/` | batch's locked signature (§4.2), concurrency's helper |
| progress-ui | Opus 5 high via Claude Code | `discovery-run-tracker.js`, `discovery-status-handoff.js`, dashboard tests under `tests/` | funnel's locked progress shape (§4.3) |

Paths under `integrations/browser-use-discovery/` are abbreviated: `src/…` and `tests/…` are the worker's, `tests/` at repo root is the dashboard's.

## 3. Six review defects and their resolution

1. **Spec Component D wrote to `dependencies.runStatusStore` from `run-discovery.ts`.** That dependency does not exist there; the webhook owns the store and refuses writes once terminal. Resolution: extend `DiscoveryRunProgress` with an optional `scoring` block (§4.3) and emit through the existing `checkpointRunProgress` callback. The webhook already copies `progress` into the status row.
2. **`stratum` never reaches the worker.** The drawer builds safe/adjacent/stretch variants, but the payload carries only `targetRoles`, keywords, and `variationKey`, and the webhook schema is contract-gated. Resolution: no stratum field. Inject `profile.identity.targetRoles` + `targetSeniority` (already in the profile) and the run's `config.targetRoles` + `includeKeywords` (already merged into the run config). Zero contract change.
3. **Proposed tests under `tests/normalize/` would never run.** Root `npm test` collects only the repo's `tests/`; `test:browser-use-discovery` lists explicit worker subdirectories, and `normalize` is not one. Resolution: new worker tests live at the worker tests root beside `profile-aware-scorer-prefilter.test.ts`, or in an already-globbed subdirectory (`tests/run/`, `tests/webhook/`).
4. **Output tokens bind before input characters.** Today's call uses `maxTokens: 2048`; twenty items with per-strength rationales cannot fit, and a truncated array is invalid JSON that the fallback would silently mask. Resolution in §4.2: `maxTokens` derived from batch size, per-strength rationale capped to one sentence in batch mode, and a logged `discovery.score.batch_truncated` event.
5. **Response schema is enforced only on the Gemini path.** Anthropic/OpenAI/OpenRouter/local get "return strict JSON" as text. Resolution: `jobId` echo, per-item parse, an explicit "return exactly N items" instruction, one retry for missing ids, then per-item single-listing fallback (not heuristic).
6. **Heuristic-scored overflow would outrank LLM-scored leads.** `selectLeadsForWrite` sorts by `fitScore` alone; legacy and LLM scores have different semantics. Resolution: listings beyond the LLM budget become a tracked rejection (`llm_budget_exhausted`), not pipeline rows.

Also dropped: the "batch parity within temperature variance" test cannot fail deterministically. Replaced by a mock-provider test asserting the batched and single prompts carry byte-identical profile blocks, plus a live-model check in `LIVE-CHECK.md`.

## 4. Locked seams (code to these exactly; lanes on either side stub the other to this shape)

### 4.1 Intent injection (lane intent)
```ts
export type SearchIntent = {
  targetRoles?: string[];      // run.config.targetRoles
  includeKeywords?: string[];  // run.config.includeKeywords
};
export type ScoreListingForProfileOptions = {
  runtimeConfig: LlmScorerRuntimeConfig;
  cache?: ListingScoreCache | null;
  signal?: AbortSignal;
  fetchImpl?: FetchImpl;
  searchIntent?: SearchIntent;
};
```
`buildSystemPrompt(profile, searchIntent?)` adds, after STRENGTHS:
```
ROLES THE USER IS PURSUING (in priority order): <profile.identity.targetRoles ∪ searchIntent.targetRoles, deduped>
TARGET SENIORITY: <profile.identity.targetSeniority>
FOCUS KEYWORDS: <searchIntent.includeKeywords>          (only when non-empty)

Some of these roles are a deliberate stretch beyond the user's past titles. A title that does not match past titles is not by itself a reason to score low. Score fit on evidence that the user's strengths satisfy this listing's requirements. When the listing is a stretch, name the specific capability gap in `concerns` rather than lowering the score for the title alone. Low scores remain valuable signal.
```
The words "reward", "bonus", and "boost" may not appear in the prompt. The cache key (`canonicalUrl | profile.updatedAt | schemaVersion`) is unchanged; intent is not part of it (locked decision 4).

### 4.2 Batch scorer (lane batch; lane funnel stubs this)
```ts
export type BatchScoreOptions = ScoreListingForProfileOptions & {
  batchSize?: number;        // default 12
  maxConcurrency?: number;   // default 3
  descriptionChars?: number; // default 3500 per listing
  onProgress?: (processed: number, total: number) => void;
};
export async function scoreListingsBatchForProfile(
  rawListings: RawListing[],
  profile: UserProfile,
  opts: BatchScoreOptions,
): Promise<Map<string /* canonicalUrl || url */, ProfileScoringOutcome>>;
```
Rules: pre-filter and cache lookup per item first, exactly as `scoreListingForProfile` does; only misses go to the model. `maxTokens = 600 × N + 400`. Prompt states "Return exactly N objects, one per JOB ID, in the same order." Per-item parse keyed by `jobId`; a missing or unparseable item is retried once in a second batch of only the missing ids, then falls back to `scoreListingWithLlm` for that item alone. Every parsed result is written to the same cache with the same key, so the existing normalizer loop hits cache afterwards. `perStrength[].rationale` limited to one sentence in the batch schema. A response whose parsed item count is below N logs `discovery.score.batch_truncated { expected, received, provider, model }`.

### 4.3 Progress shape (lane funnel emits; lane progress-ui renders)
```ts
// run-progress.ts
export interface DiscoveryRunScoringProgress {
  company: string;
  scored: number;    // items with an outcome so far (cache hits count)
  total: number;     // items submitted to the scorer for this company
  capturedAt: string;
}
export interface DiscoveryRunProgress {
  phase: DiscoveryRunProgressPhase;
  sequence: number;
  checkpointedAt: string;
  budget?: DiscoveryRunBudgetProgress;
  scoring?: DiscoveryRunScoringProgress;
}
```
Emitted via `checkpointRunProgress(currentPhase, undefined, now)` extended with the scoring block; at most one emit per second per company. The dashboard renders "Scoring 14 / 40 · Figma" in the existing run-tracker status line and hides it when `scoring` is absent.

### 4.4 Funnel (lane funnel)
Per company, after pre-filter: rank the raw listings by the deterministic `scoreListingMatch(...).overallScore` (it is `modelVersion: "deterministic-structured-v1"`; the AI matcher is a separate, already-capped call). `K = max(20, min(50, 2 × maxLeadsPerRun))`, overridable by `StoredWorkerConfig.scoringBudget` (new optional number; no UI). Reserve `ceil(K / 4)` slots for listings whose title matches any pursued role but whose keyword rank fell below K, so triage cannot cut the stretch roles the intent lane just admitted. Listings beyond K are recorded as rejection reason `llm_budget_exhausted` with `detail: "Ranked #<n> of <N>; LLM budget <K>."` and are not normalized. Log `discovery.run.llm_budget_applied { runId, company, rawCount, budget, reserved }`.

### 4.5 Concurrency (lane concurrency)
`mapWithConcurrency(items, limit, fn)` preserving input order in the output. Applied at all three normalize loops with `limit = 4`. `matchingState.aiMatchCallsUsed` is reserved before the AI matcher call (increment first, release on the non-AI path), so concurrent listings cannot overshoot the `shouldUseAiMatcher` cap. `normalizedLeads`, `extractionResult.leads`, and rejection records must be appended in original listing order after the batch resolves, so run output is byte-identical to the serial version for the same inputs. Abort signals and the budget tracker's page-limit reduction keep working; a test proves an abort mid-batch stops issuing new work.

### 4.6 Infra (lane infra)
*(E.1 below is superseded by PR #101 and is not in the lane's fence; kept for the record.)* `dev-server.mjs`: worker child gets `stdio: ["ignore", fd, fd]` on `<workerHome>/logs/worker.log` (append, `mkdirSync` recursive); the fd is closed in the parent after spawn; the log path is included in the existing start-status payload so the drawer can name it. `handle-discovery-webhook.ts`: in both terminal branches, `runStatusStore.put(...)` runs first; `safety.markTerminal()` and `safety.clear()` run only after it returns. If the completed-put throws, the catch branch must still write a failed status (its existing try/catch stays). Red-first test: a store whose `put` throws on the completed row ends with a `failed` row, never a `running` one.

## 5. Locked decisions
1. **Two waves, no timing gate (Emilio, 2026-09-02).** Wave 1 (infra, intent, concurrency) integrates first because wave 2 consumes its seams; wave 2 (batch, funnel, progress-ui) spawns from the green wave-1 integration commit immediately. Real-run timing is evidence, not a gate.
2. **Beyond-budget listings are rejections, not rows.** They were going to be cut by `maxLeadsPerRun` anyway, and heuristic rows would outrank LLM rows in the write selection.
3. **No `stratum`, no webhook schema change.** Intent comes from fields already in the profile and run config.
4. **Intent is not part of the cache key.** A cached score for a URL stays valid across variations of the same profile; profile edits already bump `updatedAt`.
5. **Concurrency default 4, batch size default 12, 3,500 description chars per listing in batch mode.** Runtime-overridable via `StoredWorkerConfig`, no drawer control in this program.
6. **Base: `feat/discovery-hardening` @ caef84c with `main` @ 04433c6 merged in (Emilio, 2026-09-02).** Hardening is 29 ahead / 138 behind main and merges cleanly (verified with `git merge-tree`, zero conflict hunks); it already touches `handle-discovery-webhook.ts`, `discovery-run-tracker.js`, and `discovery-status-handoff.js`, so basing here avoids a reconcile on the infra and progress-ui fences. Integration branch `feat/batchscore-integration`; lane branches `feat/batchscore-<lane>`; worktrees `/private/tmp/Job-Bored-batchscore-<lane>`. **This program's PR opens only after hardening's own PR has merged**, so hardening's 29 commits and its three open decisions are reviewed there, not here. Until then the integration branch is pushed as a plain backup branch with no PR (zero CI).
7. **Overflow is skipped and counted (Emilio, 2026-09-02, after plain-language re-ask).** Listings beyond the LLM budget do not enter the sheet; the run summary carries the skipped count and the budget.

## 6. Floor (every lane runs it; the orchestrator re-runs it per lane before merging)
```
npm run typecheck:browser-use-discovery
npm run test:browser-use-discovery
npm run test:contract:all
npm run lint:repo
npm test
```
Ground rules: `docs/programs/oneflow-20260831/GROUND-RULES.md` + `docs/programs/sixbeats-20260902/GROUND-RULES-ADDENDUM.md` apply. Program-specific traps go in `GROUND-RULES.md` beside this file.

## 7. Evidence
`evidence/LIVE-CHECK.md`: timed run before (25 min, from the source spec) and after wave 1, and after wave 2 if it runs; one stretch-role listing's before/after score and rationale; one board's `llm_budget_applied` log line. This file is the only unautomated proof in the program.
