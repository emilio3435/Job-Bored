DONE

**1. Verdict in 5 lines**

1. **INFERRED — highest curation leverage:** improve profile-specific sourcing and eligibility decisions. “Searching the wrong places” is substantially supported; “all discarded candidates were irrelevant” is not.
2. **CONFIRMED — major independent failure:** 14 of 28 discovery runs failed, including 11 scout-phase restarts. A7 does not preserve its catalog incrementally.
3. **CONFIRMED — real retention loss:** Run 09 discarded 90 of 105 post-dedupe survivors, but “90 qualified opportunities” overstates their demonstrated quality.
4. **INFERRED — largest volume illusion:** repeated boards explain approximately 1,266/1,994 sightings, or 63.5%, assuming unchanged responses. These are primarily repeated work, not lost distinct opportunities.
5. **CONFIRMED — A7 is useful but incomplete:** cataloguing and board dedupe help; backlog starvation, incorrect backlog ranking, incomplete profile validation, and ineffective near-miss learning remain at the reviewed cutoff.

**Review scope and evidence floor**

**CONFIRMED:** baseline `5d5b9a59`; original A7 tip `029811a4`. During review, fixups `ae747894` and `4e4e96ed` landed. I reviewed those changes and reran affected probes against **`4e4e96ed`**, the final cutoff.

References below use:

- `B/` = `/Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/`
- `F/` = `/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/`, at `4e4e96ed`.
- `D/` = baseline checkout’s `.lane-evidence/data/`.
- [Run 09 status](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/run-state/cnVuXzA5ZWM0ZmIxNzMzZWRiMjA3MTQzNjg1YjU4MmM3NDgy.json:1>) and [cap event](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/worker-log-recent-runs.jsonl:1190>) are the primary funnel evidence.

**CONFIRMED — commands and output:**

```text
git status --short --branch
## HEAD (no branch)
git rev-parse HEAD
5d5b9a59e9757cbf46ad6af213e05bce716ee2eb

sqlite3 -readonly 'file:.lane-evidence/data/worker-state.sqlite?immutable=1' \
"SELECT 'listing_fingerprints',count(*) FROM listing_fingerprints
 UNION ALL SELECT 'scout_observations',count(*) FROM scout_observations
 UNION ALL SELECT 'intent_coverage',count(*) FROM intent_coverage LIMIT 3;"
listing_fingerprints|0
scout_observations|0
intent_coverage|32
```

**CONFIRMED:** additional probes used synthetic listings, SQLite `:memory:`, a throwing network stub, and source imports pinned through `git show <commit>:<path>`. No files were changed, worker service started, network accessed, or `~/.jobbored` opened. Full suites and browser QA were not run.

**2. Claims A1–A7**

| Claim | Judgment | Evidence and correction |
|---|---|---|
| **A1** | **Corrected — CONFIRMED counts** | `1,994 − 1,665 recorded rejects − 5 non-extractable URLs = 324; −219 duplicates =105; −90 selection exclusions =15; 12 appended +3 updated.` Status and log L1190 confirm this. “Qualified” means survived a permissive accept/uncertain path, **not independently verified good fit**. `B/match/job-matcher.ts:530`: “uncertain → still surfaced.” |
| **A2** | **Corrected — CONFIRMED** | Fingerprints and scout observations are empty and unwired on baseline. However, **per-listing AI scores do persist**: 287 score-cache rows and URL-keyed breakdowns. Rejection samples are capped at five **per source**, not five total: `B/run/run-discovery.ts:2245`; cache reuse: `B/normalize/profile-aware-scorer.ts:433`, “return … score: hit.” No complete listing-fate ledger exists. |
| **A3** | **Corrected — CONFIRMED** | Role-family learning uses **selected-for-write** leads, not necessarily successfully written ones: `B/run/run-discovery.ts:1973`, `accepted: true`. Registry/surface memory seeds later ATS runs; cached scores also affect selection. Yield ordering affects grounded scouting, not baseline ATS ordering. Run 09’s effective sources excluded grounded search: log **L669**. But `browser_plus_ats` itself does not always exclude it: `B/discovery/effective-intent.ts:208–212` copies enabled sources, then honors `groundedWebEnabled === false`. |
| **A4** | **Upheld narrowly — CONFIRMED** | The structured AI matcher normally stops after `Math.max(4, Math.min(12, maxLeadsPerRun))` counted calls: `B/match/job-matcher.ts:282`. It is **not a cap on all AI fit scoring**. The separate cache contains 77 results timestamped within Run 09: 68 Low, 6 Interesting, 3 Strong. **INFERRED:** attribution to that run; cache rows have no run ID. Outer matcher timeouts can also avoid consuming the successful-call counter. |
| **A5** | **Upheld with identity caveat — CONFIRMED/INFERRED** | Five Greenhouse completions returned 203 listings at log L882/1014/1023/1030/1041; coverage credits Scale AI with 1,015. Registry plus four Scale provider surfaces explains repeated targets. **INFERRED:** identical individual jobs on all five calls, since raw URL sets were not retained. Figma’s three ×163 and Notion’s two ×128 also matter. |
| **A6** | **Corrected — CONFIRMED defaults; INFERRED poor concentration** | These are untailored fallback seeds (`B/config.ts:144`), not proof of profile-specific selection. They account for 1,760/1,994 sightings and approximately 494/728 de-repeated sightings. But **categorically unsuitable companies is unproven**: relevant commercial roles can exist at adjacent companies. Run 09 also scanned The Trade Desk, Townsquare Media, and Mediaocean. |
| **A7** | **Corrected — partial solution, CONFIRMED** | The catalog, reuse path, ATS ordering/dedupe, stats, and near-miss counters exist. The two fixups repair important original defects. They do **not** establish effective future curation, preserve every observation, or make near-miss learning useful for this profile. Remaining defects follow below. |

**3. Root-cause ranking**

**CONFIRMED arithmetic:** of the **1,979 sightings not selected**, 84.13% exit through filters, 11.07% through dedupe, 4.55% through selection, and 0.25% through source-policy skips. These are **exit shares, not percentages of valuable opportunities lost**.

| Rank / cause | Evidence | Share estimate and basis | Fixed by A7? |
|---|---|---|---|
| **1. Untailored supply plus eligibility mismatch** | Default seeds dominate; Run 09’s ten saved `excluded_keyword` examples all describe remote-policy failures. | **INFERRED:** defaults supply ~67.9% after removing inferred repeats. **UNKNOWN:** proportion of genuinely suitable jobs missed. Valid onsite rejection must not count as product loss. | **N** for targeting; partial diagnostics |
| **2. Execution reliability** | Status aggregation: 14 failed /28 discovery runs; 11 restart messages explicitly say “during the scout phase.” | **CONFIRMED:** 50% of attempts failed. Candidate/value loss is unknown because their finalized funnels are absent. | **N** |
| **3. False-negative role/location gates** | `B/profile-aware-scorer.ts:90` rejects remote-unknown; `B/match/job-matcher.ts:517` rejects role score ≤0.1 before AI rescue. | **UNKNOWN:** erroneous subset of 1,665 rejects. Samples demonstrate the mechanism, not its prevalence. | **N** |
| **4. Selection without durable novelty or useful backlog access** | 105 survivors →15 selected; repeated-run probe selects the same jobs again. | **CONFIRMED:** 85.7% of survivors omitted; 4.55% of raw exits. Valuable fraction unknown. | **Partial** |
| **5. Missing actionable feedback** | Baseline role-family reader is disconnected; A7’s target-family probe returns `[]`. | **CONFIRMED:** no complete baseline fate history; no A7 near-miss capture for these exact target titles. Value share unidentifiable. | **Partial** |
| **6. Repeated board enumeration** | Scale/Figma/Notion response counts and coverage aggregates align. | **INFERRED:** ~1,266 repeated sightings, 63.5% of traffic. Overlaps filter/dedupe exits; do not add these percentages together. | **Y**, per-run listing dedupe |

**INFERRED:** the strongest alternative framing is the better prioritization hypothesis, but an exclusive “wrong places, not dropping” diagnosis goes too far. Retrieval quality, incorrect rejection, selection, and reliability all require separate measurement.

**4. What A7 gets wrong or misses**

**CONFIRMED — original defects repaired by the fixups:** `029811a4` promoted an old Backend Engineer after changing roles/excludes, and marked a blacklisted, unwritten lead `promoted`. At `4e4e96ed`, those probes respectively submit nothing and record `rejected`. Per-lead Sheet outcomes now feed coverage, and merged targets are distinguished from skipped boards.

**Remaining issues at `4e4e96ed`:**

1. **CONFIRMED — repeated results starve backlog.** [run-discovery.ts:1768](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/run-discovery.ts:1768) allocates only `maxLeadsPerRun - leadsToWrite.length`; selection does not exclude previously written catalog entries. The probe returned:
   ```text
   repeated writes: [["Backend Engineer 1","Backend Engineer 2"],
                     ["Backend Engineer 1","Backend Engineer 2"]]
   catalog: {"backlog":1,"written":2}
   ```
   **INFERRED:** repeatedly finding the same top jobs can indefinitely prevent overflow from reaching free slots.

2. **CONFIRMED — backlog ranking reverses the main fit priority.** [discovery-memory-store.ts:3063](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/state/discovery-memory-store.ts:3063) orders `COALESCE(match_score, -1) DESC` **before** fit score. Main selection prioritizes fit score (`B/run/run-discovery.ts:3259`). The pinned probe selected **Hardware Engineer, fit 1/match 9**, ahead of **Digital Sales Director, fit 9/match 6**. There is no minimum fit floor.

3. **CONFIRMED mechanism / INFERRED risk — intent matching is not full profile revalidation.** The fixup blocks changed target roles/excludes, but [run-discovery.ts:3539](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/run-discovery.ts:3539) builds its key from query fields, omitting `userProfile`, profile version, salary floor, sponsorship constraints, and skip titles. Changing those profile values produced the **same key**. Promotion checks company scope and title excludes (`F/run/candidate-catalog.ts:284`), not `runPreFilter` or posting liveness. An unseen backlog job can therefore retain obsolete eligibility or be closed.

4. **CONFIRMED — near-miss learning is inactive for this target and disconnected from selection.** [filter-stats.ts:97](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/integrations/browser-use-discovery/src/run/filter-stats.ts:97): `if (targetFamilies.size === 0) return [];`. Both pinned tips returned `[]` for the three Run 09 target roles. `rg -n 'planCompanies\(|companyPlanner|runCompanyPlanner' …/src` finds the planner definition/server wrapper, not a discovery-run call. Counters alone do not improve targeting.

5. **CONFIRMED — yield history fragments with query rotation; INFERRED — cooldown can punish the wrong boards.** `F/run/run-discovery.ts:3543` includes query keywords in the key; `F/state/discovery-memory-store.ts:1430` loads only that exact intent. Changing “education” to “healthcare” changed the key. Snapshot replay cooled **zero** companies and ordered **Figma, Scale AI, Mediaocean, Notion, The Trade Desk, Townsquare Media**. Each stored intent contains only one run. Moreover, `F/run/ats-yield-steering.ts:242` cools zero-written companies, so valid companies hurt by remote inference or selection can be penalized while repeated low-fit updates sustain positive yield.

6. **CONFIRMED — “every listing’s fate” and bounded memory are incomplete.** The SerpApi non-extractable path increments its counter and `continue`s before catalog recording (`F/run/run-discovery.ts:1382`). Persistence occurs near run end (`F/run/run-discovery.ts:2187`), so scout restarts still lose the ledger. Rejected entries omit descriptions/location and retain `leadPayload: null` (`F/run/candidate-catalog.ts:99`); upserts overwrite `last_run_id` (`F/state/discovery-memory-store.ts:3055`), so this is current state, not per-run decision history. The catalog has 90-day/50,000-row pruning; the newly populated fingerprint table has no corresponding pruning path (`rg -n 'DELETE FROM listing_fingerprints|prune.*Fingerprint' …/src` returned none).

7. **CONFIRMED — telemetry still obscures the dominant observed rejection, and hints are transient.** `F/run/run-discovery.ts:2396` still maps every profile prefilter failure to `"excluded_keyword"`. Keyword-specific hints therefore do not explain remote-unknown losses. [runs-tab.js:1008](/Users/emilionunezgarcia/Job-Bored.worktrees/discat/runs-tab.js:1008) derives historical hints only from `state.liveJobRun`; after its stored tracker is cleared, reload/scheduled-history rendering lacks that hint.

**5. Luna report audit**

| Report | Independent spot-check | Trust and corrections |
|---|---|---|
| **I1 funnel** | Reconstructed Run 09, cap log, repeated list completions, and all-run status totals. | **High for arithmetic.** “Qualified” needs qualification. The supposedly unidentified 101 sightings are attributed in `intent_coverage` to **The Trade Desk 99 + Mediaocean 2**; exact raw URL sets remain unknown. Selection exclusions also include concentration limits: `B/run/run-discovery.ts:3081` calls `selectRankedLeads`, explaining other runs stopping below 15. |
| **I2 filters** | Verified prefilter mislabelling, matcher gate, and score-cache distribution: **68 Low/77 interval rows**. | **High for mechanisms; cautious for fit examples.** “Senior Sales Manager at Frida” points to a Tata Motors URL in the saved sample; it is not a reliable positive-control opportunity. “12 attempts” is too strict where outer timeout fallback leaves the counted-call budget unchanged. No confirmed false-negative rate was established. |
| **I3 learning** | Rechecked SQLite counts, default seeds, planner call sites, and cache reuse. | **High for architecture, corrected for routing.** `browser_plus_ats` permits enabled sources but respects explicit grounded opt-out; it did not execute grounded search here. “Written leads” should mean selected-for-write on baseline. The absolute no-per-listing-memory claim is contradicted by the score cache, which I3 itself correctly describes. |

**6. Recommended next moves**

All expected impacts below are **INFERRED**.

1. **Make backlog promotion obey current profile constraints, posting validity, and the same fit ranking as fresh leads.** Impact: prevent wrong or stale recommendations; **cost M**.
2. **Establish a labelled fit audit before widening filters:** representative rejected, capped, and written jobs, including remote-unknown and direct employer verification. Impact: distinguish legitimate filtering from recoverable opportunity loss; **cost M**.
3. **Replace default-dominated sourcing with profile-specific media/adtech revenue targets and measured exploration.** Impact: largest likely improvement in useful supply; **cost M**.
4. **Add sales/revenue role families and an uncertain-review path for plausible synonyms; split precise prefilter reasons.** Impact: recover semantic misses without treating all weak matches as good leads; **cost M**.
5. **Select for novelty and quality across fresh jobs and backlog; keep learning stable across query rotations.** Measure new suitable jobs separately from updates, and cooldown on assessed eligibility rather than write-cap outcomes alone. Impact: make future runs improve; **cost M–L**.
6. **Checkpoint listing decisions during discovery and bound all newly populated memory.** Retain enough versioned evidence to audit past decisions. Impact: preserve work across restarts and make loss attributable; **cost M**.
7. **Investigate restart/auth failures and complete the revised floor, including scheduled/reloaded history UI.** Impact: restore reliable delivery and substantiate completion; **cost M**, potentially L if restart causes are systemic.

**7. Unknowns and cheapest resolution**

- **UNKNOWN — actual valuable-loss shares.** No complete raw rejected/capped set or written-row join exists. Cheapest resolution: a representative, human-labelled export with posting content, profile version, and per-listing write fate from the next authorized run.
- **UNKNOWN — exact unique sightings and every board’s historical input.** Counts strongly support repeats; they do not prove identical URL sets. Cheapest resolution: log canonical board identity and listing fingerprint at enumeration.
- **UNKNOWN — Run 09’s actual bad-fit writes.** Time-window cache scores cannot identify the 15 selected rows. Cheapest resolution: join a read-only Pipeline export to cached canonical URLs and score versions.
- **UNKNOWN — causes and recoverable work behind failed runs.** Snapshot errors establish restarts/401/fetch failure, not underlying operational causes. Cheapest resolution: inspect the corresponding service lifecycle/auth logs offline.
- **UNKNOWN — full-floor green at the final cutoff.** I did not independently run it. The supplied green claim differs from the available [Sol report](/Users/emilionunezgarcia/Job-Bored/docs/programs/discat-20260927/reports/REPORT-SOL-verify.md:1), which reports typecheck success but blocked worker/root suites and unverified browser smoke. Cheapest resolution: attach exact-cutoff command outputs and identify the claimed pre-existing failing test.