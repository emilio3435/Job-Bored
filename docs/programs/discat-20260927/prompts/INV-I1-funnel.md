# Lane I1: funnel forensics (data, not code)

Read `INV-_SHARED.md` (same folder, pasted above) first.

Question: across every run in the snapshot, where exactly do listings go, how much of the volume is real, and is the drop mostly correct filtering or loss?

Hypotheses to test (from the orchestrator; try to refute them):
- H1: run_09ec4fb1 funnel = 1994 seen → 1665 filtered (excluded_keyword 1181, headline_mismatch 484) → 324 normalized → 105 after dedupe → 15 by `maxLeadsPerRun=15` (90 qualified discarded) → 12 appended + 3 updated.
- H2: the "1994" is inflated: the Scale AI Greenhouse board was listed ~5× in one run (1015 = 5×203), so the unique count is closer to ~1200.
- H3: most volume comes from boards that never yield (Scale AI 1218 seen / 7 written, Figma 652 / 8, Notion 384 / 2 over 2 runs).
- H4: 31 run files, many `failed`; the failures are a separate problem that also loses candidates.

Do:
1. Build one per-run funnel table from run-state for all 31 runs: seen, rejected by reason, normalized, deduped, capped, written, status, failure reason. Summarize the failed runs by reason class.
2. From the log (`ats_list_started` / `ats_list_completed`, `ats_company_*` events) and `exploit_outcomes`, determine per board how many times it was listed in run_09ec4fb1 and why (same company twice under different keys? retries? seed plus memory duplication?). Find the code path that allows it (`run-discovery.ts` ~630–900 builds the ATS company list from config plus memory; check for missing dedupe).
3. Estimate unique listings per run and the real loss: qualified-but-dropped vs correctly rejected.
4. Check whether any run shows `write_selection_capped` and how often the cap binds across runs.
