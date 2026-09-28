DONE — all 31 status records and the available run logs were examined; remaining limits on exact attribution and raw uniqueness are reported below.

## 1 Findings

**Read-only floor command:** `sqlite3 -readonly 'file:.lane-evidence/data/worker-state.sqlite?immutable=1' ".tables"`  
**Output:** `career_surfaces company_registry discovery_run_status exploit_outcomes intent_coverage listing_fingerprints scout_observations dead_link_cache host_suppressions role_families`. The per-run aggregation output is in §3. No tests, worker run, network call, or file edit was made.

1. **CONFIRMED — run `run_09ec4fb1`:** 1,994 source sightings; 1,665 rejected by recorded reasons (1,181 `excluded_keyword`, 484 `headline_mismatch`); 5 more SerpAPI URLs skipped as non-extractable; 324 accepted; 219 duplicate suppressions leave 105; the cap selected 15 and suppressed 90; 12 were appended and 3 updated. [Status record](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/run-state/cnVuXzA5ZWM0ZmIxNzMzZWRiMjA3MTQzNjg1YjU4MmM3NDgy.json:1>), [cap event](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/worker-log-recent-runs.jsonl:1190>), and [selection-count assignment](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/run/run-discovery.ts:2073>). The status field named `normalizedLeadCount` records the selected write set, not the 324 source-accepted listings.

2. **CONFIRMED — repeated list calls in run 09:** There were 18 company iterations. Greenhouse had 11 nonzero list completions totaling 1,710; Ashby had 18 completions totaling 256, of which two returned 128 and 16 returned zero. The five Greenhouse completions of 203 are at [L882](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/worker-log-recent-runs.jsonl:882>), [L1014](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/worker-log-recent-runs.jsonl:1014>), [L1023](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/worker-log-recent-runs.jsonl:1023>), [L1030](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/worker-log-recent-runs.jsonl:1030>), and [L1041](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/worker-log-recent-runs.jsonl:1041>). The per-run events record ordinal, source, and count, but not company or board identity.

3. **INFERRED — duplicate-target cause:** Five 203-result calls match the `scaleai/greenhouse` outcome of 1,015 sightings. Three 163-result calls match Figma’s 489; two 128-result Ashby calls match Notion’s 256. This strongly supports repeated board fetches. There is no retry-specific event; the evidence shows separate top-level calls at different company ordinals. The likely mechanism is duplicate configured/memory targets: the run builds its search list by concatenating configured and memory targets at [run-discovery.ts:711](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/run/run-discovery.ts:711>); the pool copies ATS targets at [effective-intent.ts:234](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/discovery/effective-intent.ts:234>) while deduping only the separate catalog at [effective-intent.ts:240](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/discovery/effective-intent.ts:240>). Exact input targets for each ordinal are not retained.

4. **CONFIRMED — candidate memory is aggregate, not a complete listing ledger:** In the snapshot database, run 09 has 24 `exploit_outcomes` rows, while `listing_fingerprints` and `scout_observations` each have zero rows. Outcomes are grouped from accepted leads at [run-discovery.ts:1796](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/run/run-discovery.ts:1796>); a source with no accepted-lead group is skipped at [run-discovery.ts:1821](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/integrations/browser-use-discovery/src/run/run-discovery.ts:1821>). The separate fit-score cache has 287 rows and 192 breakdown rows, but its schema has no run ID or rejection reason, so it cannot reconstruct this funnel.

## 2 Refuted or corrected hypotheses

- **H1 — CONFIRMED, with a naming caveat.** All listed counts match. The five additional sightings are the SerpAPI hint-only/blocked URLs; `normalizedLeadCount=15` is the selected write set, as confirmed by the code reference above.
- **H2 — PARTLY CONFIRMED.** Scale’s 1,015 sightings match five 203-result calls. Correcting only those repeats gives 1,182 response slots, assuming the same listings came back each time. Figma’s 489 and Notion’s 256 also match repeated calls; if those sets were unchanged too, the rough estimate falls to about 728 slots. Neither is an exact unique-URL count: the log does not identify boards per event, and 101 Greenhouse sightings (99 + 2) have no matching outcome row.
- **H3 — VOLUME CONFIRMED; “never yield” REFUTED.** Across runs 09 and 70, Scale/Figma/Notion total 1,218/652/384 sightings and 7/8/2 writes. Together they account for 2,254 of 2,488 sightings and 17 of 25 writes. Their yield is low, but not zero.
- **H4 — FAILURES CONFIRMED; candidate loss UNQUANTIFIED.** Of 31 status files, 28 are discovery runs and 3 are URL ingests. Fourteen discovery runs failed: 11 worker restarts during scout, 2 Pipeline `HTTP 401` failures, and 1 `fetch failed`. Failed records have no finalized source totals; the 11 restart records preserve only the scout phase, not listing counters. The separate failed ingest was blocked as an aggregator.

## 3 Numbers

**CONFIRMED — per-run table:** read-only aggregation of `status.*` across all 31 files under `.lane-evidence/data/run-state/`. IDs are shortened to their first eight characters after the prefix. `EX/HM/RP` mean excluded keyword/headline mismatch/remote-policy mismatch; `other` is seen minus accepted and reason counts. `EXP/DUP` are lifecycle exploration/duplicate suppression counters. `?` means cap-event logs were not retained for that run.

| ID | State | Seen / reason counts | Accepted − EXP − DUP = remaining | Selected / appended+updated | Cap or issue |
|---|---|---:|---:|---:|---|
| `run_b9448484` | partial | 541 / EX9 HM1 other5 | 526−508−0=18 | 12 / 8+4 | ? |
| `ingest_81d742e1` | completed | — | — | — | cheerio_dom |
| `run_c9d4ebe5` | failed | — | — | — | restart_scout |
| `run_85d24d9b` | failed | — | — | — | restart_scout |
| `run_74492b3e` | partial | 543 / EX11 other8 | 524−506−0=18 | 10 / 10+0 | ? |
| `run_bc5e2477` | partial | 164 / HM1 other7 | 156−138−0=18 | 3 / 3+0 | ? |
| `run_a75c5b6b` | failed | — | — | — | restart_scout |
| `run_6cfebf04` | failed | — | — | — | restart_scout |
| `run_296d5b3a` | partial | 513 / EX401 HM77 RP34 other1 | 0−0−0=0 | 0 / 0+0 | weak_ats_seed_quality |
| `run_c9930548` | partial | 513 / EX512 other1 | 0−0−0=0 | 0 / 0+0 | weak_ats_seed_quality |
| `run_7052ccd3` | partial | 511 / EX397 HM77 RP34 other3 | 0−0−0=0 | 0 / 0+0 | weak_ats_seed_quality |
| `run_638efae2` | partial | 502 / EX502 | 0−0−0=0 | 0 / 0+0 | weak_ats_seed_quality |
| `run_25b55ccc` | partial | 502 / EX502 | 0−0−0=0 | 0 / 0+0 | weak_ats_seed_quality |
| `run_c88bc07c` | partial | 502 / EX502 | 0−0−0=0 | 0 / 0+0 | weak_ats_seed_quality |
| `ingest_e19b3ffe` | failed | — | — | — | blocked_aggregator |
| `ingest_bce9c812` | completed | — | — | — | ats_api |
| `run_83e21904` | partial | 532 / EX271 HM4 other8 | 249−231−0=18 | 7 / 7+0 | ? |
| `run_4e690b53` | failed | — | — | — | restart_scout |
| `run_4c11a85e` | failed | — | — | — | restart_scout |
| `run_1ed1abad` | failed | — | — | — | restart_scout |
| `run_0481fd78` | failed | — | — | — | restart_scout |
| `run_6d2b304d` | failed | — | — | — | restart_scout |
| `run_32a56496` | failed | — | — | — | restart_scout |
| `run_f2fbe808` | failed | — | — | — | restart_scout |
| `run_cba65977` | failed | — | — | — | fetch_failed |
| `run_13f7c181` | failed | — | — | — | sheets_401 |
| `run_01ccc5fe` | failed | — | — | — | sheets_401 |
| `run_b8cb782d` | partial | 537 / EX64 HM313 RP82 other6 | 72−54−0=18 | 11 / 11+0 | cap 7 |
| `run_70e3ed35` | completed | 494 / EX286 HM119 | 89−0−0=89 | 10 / 10+0 | cap 79 |
| `run_09ec4fb1` | partial | 1,994 / EX1,181 HM484 other5 | 324−0−219=105 | 15 / 12+3 | cap 90 |
| `run_b8d4a6e2` | running | 2,788 partial ATS sightings† | pending | pending | unfinished |

† **CONFIRMED:** `run_b8d4a6e2` had 42 completed company iterations and 64 ATS list completions by the last captured log timestamp, 05:17:52Z: 2,532 Greenhouse and 256 Ashby sightings. No finalized rejection, selection, or write totals were present.

**CONFIRMED — exact logged cap binds:** three events, at [run b8cb](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/worker-log-recent-runs.jsonl:243>) (18→11, suppress 7), [run 70](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/worker-log-recent-runs.jsonl:651>) (89→10, suppress 79), and [run 09](</Users/emilionunezgarcia/Job-Bored.worktrees/discat-inv/.lane-evidence/data/worker-log-recent-runs.jsonl:1190>) (105→15, suppress 90). These cover the three completed runs in the retained log window; full 31-record cap frequency is unknown.

**CONFIRMED — 13 finalized discovery funnels:** 7,848 sightings, 5,864 reason-coded rejects (EX4,638; HM1,076; RP150), 44 other/uncategorized, 1,940 accepted, 1,437 exploration suppressions, 219 duplicate suppressions, 68 selected, and 68 appended/updated. These are sightings, not unique listings; failed runs and the in-progress run are excluded.

**CONFIRMED — SQLite `exploit_outcomes` query for run 09 plus run 70**, grouped by company and source, returned:

| Company | Source | Runs | Seen | Accepted | Rejected | Written |
|---|---|---:|---:|---:|---:|---:|
| Figma | Greenhouse | 2 | 652 | 171 | 481 | 8 |
| Notion | Ashby | 2 | 384 | 12 | 372 | 2 |
| Scale AI | Greenhouse | 2 | 1,218 | 200 | 1,018 | 7 |

## 4 What you could not check

- **UNKNOWN:** Exact unique raw listing URLs per run. The snapshot has no `listing_fingerprints` or `scout_observations` rows, and logs retain counts rather than listing IDs.
- **UNKNOWN:** Exact company/board identity for every run-09 ordinal. The outcomes aggregate by normalized company and source; the event records omit the board name. The 101 Greenhouse sightings without outcome rows are consistent with rejected-only company groups being skipped by the persistence path, but their company identity is unavailable.
- **UNKNOWN:** Whether all 1,665 run-09 rejects were correct. Samples show onsite Notion listings rejected under a remote-only policy, but also `remoteBucket=unknown` listings grouped under `excluded_keyword`; samples are not a representative audit.
- **UNKNOWN:** Final funnel or cap result for the 14 failed discovery runs or the in-progress run. The latest in-progress log is only a partial count. The older log window is not retained.
- **CONFIRMED:** No separate `INV-_SHARED.md` file was found in the checkout; I used the shared brief pasted in the prompt.

## 5 Top 3 recommendations with expected impact

1. **INFERRED — Deduplicate ATS targets by canonical company, provider, and board URL before listing.** Run 09 alone shows five matching Scale passes; likely repeated Figma and Notion passes add more. Under identical-list assumptions, those three corrections reduce about 1,266 of 1,994 run-09 sightings.
2. **INFERRED — Persist a per-listing ledger with run, board, stable fingerprint, rejection reason, score, and selection outcome; checkpoint it before long stages.** This would make the 90 cap-suppressed candidates reviewable and provide recovery evidence across the 11 scout restarts.
3. **INFERRED — Separate keyword rejection from remote-policy rejection and route unknown-location listings to review.** This preserves strict onsite filtering while exposing potential false negatives currently counted as `excluded_keyword`; the recoverable count is unknown.