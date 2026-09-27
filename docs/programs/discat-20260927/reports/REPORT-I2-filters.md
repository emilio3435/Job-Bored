DONE

## 1 Findings

1. **[CONFIRMED] Read-only floor output:** `git status --short --branch && git rev-parse HEAD`

   ```text
   ## HEAD (no branch)
   5d5b9a59e9757cbf46ad6af213e05bce716ee2eb
   ```

2. **[CONFIRMED] Run 09’s intent:** target roles were Director of Digital Sales, Head of Digital Strategy, and Director of AI Solutions; the search query added GTM Operations Manager. It specified remote work, Director seniority, no locations, and include/exclude terms. The redacted worker config shows different fallback roles, but the request’s effective intent overrides stored roles and keywords. [run state:1](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/run-state/cnVuXzA5ZWM0ZmIxNzMzZWRiMjA3MTQzNjg1YjU4MmM3NDgy.json:1>), [worker config:1](/Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/worker-config.redacted.json:1), [effective intent](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/config.ts:984>)

3. **[CONFIRMED] Run 09 funnel:** 1,994 listings seen; 1,665 rejected; 5 SerpApi URLs skipped as hint-only/blocked; 324 leads accepted by the filter/matcher path. Of those 324, 219 were duplicates, leaving 105 unique candidates. The write selector chose 15: 12 appended and 3 updated. The other 90 unique candidates were not selected under the 15-lead cap. `normalizedLeadCount=15` records the final write set, not all leads that passed filtering. [run state:1](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/run-state/cnVuXzA5ZWM0ZmIxNzMzZWRiMjA3MTQzNjg1YjU4MmM3NDgy.json:1>), [dedupe](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/run/run-discovery.ts:1586>), [write selection](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/run/run-discovery.ts:1633>), [reported count](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/run/run-discovery.ts:2073>)

4. **[CONFIRMED] `excluded_keyword` is overloaded.** In the main path, any `runPreFilter` failure becomes `excluded_keyword`; that prefilter also rejects remote-only jobs whose inferred bucket is unknown, plus skip-title, location, work-authorization, and salary constraints. In Run 09, all 10 saved samples under this reason say `remoteBucket=onsite` or `unknown`; none of their titles or company names match that run’s exclude terms. Across all 141 saved samples, 95 of the 115 `excluded_keyword` examples are remote-only prefilter failures, 9 are explicit keyword hits, and 11 have other details. [run-discovery:2178](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/run/run-discovery.ts:2178>), [prefilter](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts:54>), [Run 09 state:1](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/run-state/cnVuXzA5ZWM0ZmIxNzMzZWRiMjA3MTQzNjg1YjU4MmM3NDgy.json:1>)

5. **[CONFIRMED] Keyword matching is usually boundary-based.** The normalizer and structured matcher use word boundaries for ordinary alphanumeric terms, so `intern` does not match `international`. Across saved samples, the only title/company exclusion hits were `assistant` (5) and `intern` (4), each appearing as a full title word. A separate `UserProfile.hardConstraints.skipTitles` check uses substring matching; the snapshot does not expose that list, so substring risk there is unknown. [normalizer matcher](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/normalize/lead-normalizer.ts:495>), [matcher phrase rule](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/match/job-matcher.ts:711>), [skipTitles check](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts:60>)

6. **[CONFIRMED] The active role gate can miss synonyms before AI review.** The run path uses a structured matcher, with role phrases, a small set of role families, and token overlap; it does not use only the normalizer’s literal headline check. But the role families contain no sales/revenue family (`rg -n "revenue|sales|revops|sales_leadership|digital_sales" .../job-matcher.ts` returned no matches). A role with no phrase/family match and role score `0.1` is rejected. The AI matcher is skipped for baseline rejects, and the later profile scorer runs only after a non-reject decision. Thus a “Head of Revenue” title against “Director of Digital Sales” can be rejected before either AI path rescues it. [role families](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/match/job-matcher.ts:38>), [role scoring](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/match/job-matcher.ts:535>), [reject threshold](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/match/job-matcher.ts:515>), [AI eligibility](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/match/job-matcher.ts:282>), [normalizer called after non-reject](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/run/run-discovery.ts:2286>)

7. **[INFERRED] There are plausible false-negative examples, but no confirmed count.** Three saved title examples merit review: Run 09’s Senior Sales Manager at Frida and Digital Health Strategist, plus Run `b8cb`’s Sr. Manager, User Acquisition against growth/performance-marketing targets. Run 09 also rejected remote-unknown Ad Operations Manager and Associate Account Director listings. Titles alone cannot establish that the postings met the user’s full criteria. [Run 09 state:1](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/run-state/cnVuXzA5ZWM0ZmIxNzMzZWRiMjA3MTQzNjg1YjU4MmM3NDgy.json:1>), [Run b8cb state:1](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/run-state/cnVuX2I4Y2I3ODJkNTIwY2IwYTM1MTMyNzk4NzJkNDBjYWM2.json:1>)

8. **[CONFIRMED] There are two distinct AI paths.** The job matcher is capped at 12 attempts per run. In the in-progress `b8d4` snapshot, 2,791 listings were processed and `matcherCalls=12` (0.43%). Separately, the profile-fit scorer generated 77 cache results during Run 09’s active interval; 68 were labeled Low, 6 Interesting, and 3 Strong. The cache contains 287 rows total, with 271 Low. Cache timestamps do not store run IDs, so time-window attribution is evidence-based but not a direct per-run counter. [call cap](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/match/job-matcher.ts:282>), [b8d4 progress:1](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/run-state/cnVuX2I4ZDRhNmUyNWM2YjdmNTVmMTQ2ZWY3OThhYjZkZmUw.json:1>), [profile scorer/cache path](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts:415>)

9. **[CONFIRMED] Low-fit candidates reach scoring; actual bad writes are unknown.** In Run 09’s cache window, several score-1 rationales describe broadcast RF/hardware engineering or low-paid work as mismatches for digital revenue/AI leadership. The write selector sorts by `fitScore` and caps the list, but has no minimum fit-score threshold. The evidence does not link those scored listings to the 15 rows written or updated. [Run 09 score query: `listing_score_cache`, `created_at` 04:45:50–04:52:45 UTC, `GROUP BY fitScore, band LIMIT 10`](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/worker-state-listing-scores.sqlite>), [selector](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/run/run-discovery.ts:3064>), [ranking](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/run/run-discovery.ts:3255>)

## 2 Refuted or corrected hypotheses

- **[CONFIRMED] H5 corrected:** the 1,181 `excluded_keyword` count does not establish that broad exclude terms caused those rejections. Run 09’s saved examples are all remote-only failures; across all saved examples the reason bucket also includes remote and other hard constraints. The exact split of the 1,181 is not recorded.

- **[CONFIRMED] H6 partly supported:** the active matcher is structured rather than purely literal, but has limited role families and hard-rejects weak role overlap before AI review. Semantic misses are credible; the sample does not quantify their rate.

- **[CONFIRMED] H7 split:** the 12-call matcher cap is real. “Therefore almost all judgment is keyword-only” is false as stated: the separate profile-fit scorer produced many more cached LLM scores. The exact number of scorer invocations per run is not persisted.

- **[UNKNOWN] H8:** low-fit candidates appear in the scoring pool and the write selector has no fit floor, but there is no candidate-level record of which listings were written. The exact hosts `liveblog365`, `dedyn.io`, and `my-board.org` occur zero times in the 141 rejection-sample URLs and recent log snapshot; that does not show whether they were written.

## 3 Numbers

| Measure | Result |
|---|---:|
| [CONFIRMED] Run 09 seen / rejected | 1,994 / 1,665 |
| [CONFIRMED] Run 09 accepted / skipped hint-only | 324 / 5 |
| [CONFIRMED] Run 09 duplicates / unique candidates / selected | 219 / 105 / 15 |
| [CONFIRMED] Run 09 appended / updated | 12 / 3 |
| [CONFIRMED] Run 09 rejection reasons | 1,181 `excluded_keyword`; 484 `headline_mismatch` |
| [CONFIRMED] Saved samples across lifecycle runs | 141: 115 excluded, 19 headline, 7 remote-policy |
| [CONFIRMED] Exclusion-hit examples across samples | `assistant`: 5; `intern`: 4 |
| [INFERRED] Run 09 profile-score cache results in its time window | 77: 68 Low, 6 Interesting, 3 Strong |
| [CONFIRMED] In-progress `b8d4` checkpoint | 2,791 processed; 12 matcher attempts; 121 profile-score cache rows in its time window |
| [UNKNOWN] Confirmed false negatives / bad-fit writes | 0 confirmed / unknown; for Run 09, bad-fit writes are bounded 0–15 |

## 4 What you could not check

- **[UNKNOWN]** Exact false-negative and false-positive rates: rejection samples are capped at five per source, and written titles, descriptions, scores, and URLs are absent from the run status. The read-only memory query `SELECT count(*) FROM listing_fingerprints LIMIT 1` returned `0`; score-cache rows have no run ID to join to writes.
- **[UNKNOWN]** The full descriptions behind remote-unknown and title-mismatch samples, needed to decide whether they truly matched the user’s role and remote requirements.
- **[CONFIRMED]** The checkout had no `INV-_SHARED.md` path in the parent file listing; I read the user-provided brief and the duplicate `.lane-evidence/prompt-I2-filters.md`. No tests, worker runs, or network calls were made.

## 5 Top 3 recommendations with expected impact

1. **[INFERRED] Split rejection telemetry into precise causes**—explicit keyword, skip title, onsite, remote unknown, location, salary, and authorization. This would show what actually drives the 1,181 count and expose remote-unknown candidates for review.

2. **[INFERRED] Expand role-family synonyms and send weak semantic matches to an uncertain path before hard rejection.** This should recover adjacent titles such as User Acquisition, Digital Health Strategist, and Revenue leadership roles without treating every weak match as a write.

3. **[INFERRED] Persist a per-listing decision ledger and add a low-fit write floor.** Record source, rejection stage/reason, matcher usage, fit score, and final write status. This would enable real FP/FN calibration and reduce the chance that a low-scored candidate fills the 15-lead cap.