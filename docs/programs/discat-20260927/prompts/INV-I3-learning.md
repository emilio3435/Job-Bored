# Lane I3: does anything learn? And why these companies?

Read `INV-_SHARED.md` (same folder, pasted above) first.

Question: which state does discovery persist, which of it is ever read back to change a later run, and why is it searching these companies for this user?

Hypotheses to test (try to refute them):
- H9: `listing_fingerprints` and `scout_observations` are write-never. Both have 0 rows; `upsertListingFingerprints` (src/server.ts:252) and `writeScoutObservation` have no caller in the run path.
- H10: the learn phase (`run-discovery.ts` ~1880–1990) learns role families only from the ≤15 written leads; rejections and near-misses teach nothing.
- H11: yield memory (`buildScoutYieldMap`, run-discovery.ts ~3313, used ~1152 and ~1405) only affects the grounded-web scout, which the presets `ats_only` / `browser_plus_ats` exclude, so it has no effect on ATS board selection.
- H12: the target companies (Scale AI, Figma, Notion, …) don't fit the user's profile (digital media / ad sales leadership); the company planner (`src/discovery/company-planner.ts`, `profile-to-companies.ts`) or the stored seeds are the cause.

Do:
1. For every memory table: find its writers and readers (`rg -n` over `src/`) and state whether a later run's behaviour changes because of it. Produce a table: table · rows in snapshot · written by · read by · affects next run? (Y/N, cite).
2. Trace ATS company selection end to end: config seeds, memory `company_registry` / `career_surfaces`, planner, ordering, caps. Say where yield or feedback could plug in, and whether anything already does.
3. Explain why Scale AI / Figma / Notion are targets for this profile (seed source? planner output? memory?). Cite the evidence.
4. Check `listing_score_cache` reuse: is a cached AI score reused across runs, and does it influence selection?
5. Name any other place where information is computed and then thrown away.
