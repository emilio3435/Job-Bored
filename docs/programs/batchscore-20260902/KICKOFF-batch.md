# KICKOFF — lane `batch` (wave 2; branches from the green wave-1 integration commit)

Read `GROUND-RULES.md` and `BATCHSCORE-SPEC.md` §3 items 4–5 and §4.2 first. Create `LANE-REPORT-batch.md` before anything else.

## Mission
A new `scoreListingsBatchForProfile` scores up to twelve listings per model call, parses each item independently, retries the missing ones once, falls back per item to the single-listing call, and writes every result to the same cache with the same key, so the existing per-listing path becomes a cache hit afterwards.

## Fence (you own exactly these)
- `integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts` — a new section below the single-item orchestrator (`scoreListingForProfile`) and above the legacy heuristic block. You may add exports. You may not edit `buildSystemPrompt`, `buildUserPrompt`, `buildResponseSchema`, `scoreListingWithLlm`, or `scoreListingForProfile`; call them.
- New test: `integrations/browser-use-discovery/tests/profile-aware-scorer-batch.test.ts` (worker tests root — see the ground-rules trap on placement).

## Consumes
- `buildSystemPrompt(profile, searchIntent?)` and `SearchIntent` from the `intent` lane (already on your base).
- The `ListingScoreCache` interface in `state/listing-score-cache.ts` (unchanged).
- `callWorkerChatProvider` in `ai/chat-provider.ts` (unchanged; note only the Gemini path honors `responseSchema` — the others receive it as text instructions).

## Non-negotiables
- Signature and option defaults exactly as §4.2: `batchSize` 12, `maxConcurrency` 3, `descriptionChars` 3500, `onProgress(processed, total)`. Returns `Map<canonicalUrl || url, ProfileScoringOutcome>`.
- Per item, before any model call: `runPreFilter` then cache lookup, producing the same outcomes `scoreListingForProfile` would. Only misses are batched.
- Prompt: the system prompt is byte-identical to the single path's `buildSystemPrompt(profile, searchIntent)` followed by the batch schema; the user prompt carries one `--- JOB ID: <id> ---` block per listing with the description cut at `descriptionChars`, and the sentence "Return exactly N objects, one per JOB ID, in the same order." with N substituted.
- `maxTokens = 600 × N + 400`, asserted via a fetch spy.
- Batch schema: the single schema's item shape plus `jobId`, with `perStrength[].rationale` described as one sentence. Reuse `buildResponseSchema(profile)` for the inner shape.
- Parsing: keyed by `jobId`; unknown ids ignored; an item with a non-numeric `fitScore` counts as missing. Missing ids go into one retry batch; anything still missing goes through `scoreListingWithLlm` alone. Every recovered result is a normal `ok: true` outcome with `llmCalled: true`.
- A parsed item count below N logs `discovery.score.batch_truncated { expected, received, provider, model }` through whatever logger the runtime config or options already expose; if none is reachable from this module, return the count in the result map's metadata and say so in the report rather than adding a logger dependency.
- Cache writes use `buildCacheKey(canonicalUrl, profile)` (the existing private helper — export it if needed, do not duplicate it) and `putBreakdown(canonicalUrl, score)`, exactly as the single path does. A test proves a batch-scored URL is then a cache hit for `scoreListingForProfile`.
- Red-first tests, named for behavior: prompt has exactly N blocks and the exactly-N sentence; maxTokens formula; per-item parse survives one missing id (N−1 cached, one retried, one single-fallback); truncation is reported; batch and single system prompts are identical; cache symmetry.

## Definition of Done
1. Report section 2 shows every test above red, then green.
2. Full floor pasted into report section 4:
   ```
   npm run typecheck:browser-use-discovery
   npm run test:browser-use-discovery
   npm run test:contract:all
   npm run lint:repo
   npm test
   ```
3. Commit locally (`feat(discovery): batch fit scoring with per-item recovery`), never push. Keep scratch in `.lane-evidence/`. Delete nothing.
