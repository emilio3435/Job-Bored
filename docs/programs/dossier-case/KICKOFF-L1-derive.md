# Kickoff · L1 derive (claim B) — view-model derivation, transport, focus guard

Read `docs/programs/dossier-case/GROUND-RULES.md` first. `jb-text.js` (`window.JobBoredText`) is already merged into your branch — use it, never reimplement it.

Execute, in this order:

1. Resilience plan **Task 5** — role.js focus guard covers `[data-action="notes"]` and defers + flushes on blur; fact-input width fallback. (`docs/superpowers/plans/2026-08-31-dossier-render-resilience.md`)
2. Resilience plan **Task 7** — `_splitJdSections` on `toBlocks`.
3. Resilience plan **Task 8** — tags / talking-points / JSON-attr repairs in `dawn-data.js`.
4. Resilience plan **Task 9** — `pipeline-render.js` clip + `escapeAttr`.
5. Case plan **Task 1** — new card attrs + view-model fields (`priority, favorite, logoUrl, matchScore, lastHeardFrom, followUpDate, replied, requirements, skills, foundAt, talkingPoints, enrichment.enrichedAt, enrichment.scrapeMethod`). (`docs/superpowers/plans/2026-09-01-dossier-case-redesign.md`)

**Mission.** After you, `getRoleViewModel(jobKey)` returns everything the Case model reads (Case spec §4), parsed through the shared block model, and the kanban card carries every attribute the Case needs.

**Fence.** L1 row of the ground rules. `role.js`: the guard/flush/width-fallback only — do NOT touch rendering (L5 owns the cutover). `pipeline-render.js`: v2Attrs + `_clip`/`_attrEsc` only — the legacy drawer render code is untouched.

**Consumes.** `window.JobBoredText` (merged). **Produces for L4/L5:** the view-model field names above, exactly.

**Non-negotiables.** Attribute names are additive; existing ones and budgets unchanged (trap 7). `tests/dossier-card-attrs.test.mjs` and `tests/dossier-workshop-events.test.mjs` keep every existing assertion. The guard test's input stub must accept the comma-joined selector (plan Task 5 Step 1).

**Definition of Done.**
1. `node --test tests/dawn-data-jd-blocks.test.mjs tests/dossier-card-attrs.test.mjs tests/role-field-edit-render-guard.test.mjs tests/dawn-data-lead-stories.test.mjs tests/dawn-by-the-numbers-30d.test.mjs tests/pipeline-newest-sort.test.mjs tests/pipeline-collapse-scroll.test.mjs` green.
2. Full floor green — pasted in `LANE-REPORT-L1.md` §4.
3. One commit per task with the plans' messages.
