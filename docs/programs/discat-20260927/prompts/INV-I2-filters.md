# Lane I2: are the filters right? (fit quality)

Read `INV-_SHARED.md` (same folder, pasted above) first.

Question: of the ~1665 listings rejected per big run, how many were wrongly rejected (false negatives), and how many of the written leads are bad fits (false positives)? Is the pipeline curating toward the user's actual profile?

Hypotheses to test (try to refute them):
- H5: `excluded_keyword` (1181 in run_09ec4fb1) is driven by a few broad exclude keywords and likely over-rejects.
- H6: `headline_mismatch` is a lexical title match against targetRoles that misses synonyms (for example "Director, Digital Sales" vs "Head of Revenue").
- H7: only ~12 AI matcher calls happen per run (`src/match/job-matcher.ts:282`, `max(4, min(12, maxLeadsPerRun))`), so almost all judgement is keyword-only.
- H8: written leads include poor fits (for example SerpApi hits from aggregator/spam hosts such as liveblog365, dedyn.io, my-board.org).

Do:
1. Pull the user's intent: `profileSnapshot` / `searchPlan` in `run-state/*09ec4fb1*` (decode filenames: base64 of the run id), plus `worker-config.redacted.json`: targetRoles, include/exclude keywords, locations, remote policy, seniority.
2. Read the filter code: `src/normalize/lead-normalizer.ts` (~150–320) and `run-discovery.ts` ~2170–2360, and write down exactly how each rejection reason is decided.
3. Use all rejection samples across the run-state files, plus `listing_score_cache` / `listing_score_breakdown` (fit scores with rationales), to judge false-negative and false-positive rates. Give counts and examples.
4. Check which exclude keyword hits most often (reproduce the matching on the sample titles if it isn't logged) and whether the matching is substring-based (for example "intern" matching "international").
5. Verify H7 and measure how many listings reach the AI scorer vs keyword-only decisions.
